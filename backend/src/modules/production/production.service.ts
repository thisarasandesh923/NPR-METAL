import type { Pool } from "pg";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../errors/appError.js";
import { formatScaledDecimal, parseScaledDecimal } from "../../utils/money.js";
import {
  insertOperationalHistory,
  type OperationalApprovalStatus,
} from "../approvals/approvals.repository.js";
import { insertAuthAuditLog } from "../auth/auth.repository.js";
import type { UserRole } from "../auth/auth.types.js";
import { findMachineById } from "../machines/machines.repository.js";
import { findActiveMaterialsByIds } from "../materials/materials.repository.js";
import { findWorkerById } from "../workers/workers.repository.js";
import {
  findProductionLogById,
  insertProductionDraft,
  listProductionLogs,
  transitionProductionStatus,
  updateProductionDraftRow,
} from "./production.repository.js";
import type { ProductionLogDto, ProductionLogInput } from "./production.types.js";

function parseQuantityProducedStr(raw: string | number): string {
  let milli: bigint;
  try {
    milli = parseScaledDecimal(raw, 3, "Quantity produced");
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : "Invalid production quantity."
    );
  }
  if (milli <= 0n || milli > 1_000_000_000n) {
    throw new ValidationError(
      "Quantity produced must be greater than 0.000 m³."
    );
  }
  return formatScaledDecimal(milli, 3);
}

export class ProductionService {
  constructor(private readonly pool: Pool) {}

  async listLogs(filters: {
    dateFrom?: string;
    dateTo?: string;
    materialId?: number;
    machineId?: number;
    status?: OperationalApprovalStatus;
  }): Promise<ProductionLogDto[]> {
    return listProductionLogs(this.pool, filters);
  }

  private async validateReferences(
    client: import("pg").PoolClient,
    input: ProductionLogInput
  ): Promise<void> {
    const mats = await findActiveMaterialsByIds(client, [input.materialId]);
    if (mats.length === 0) {
      throw new ValidationError("Selected material is invalid or inactive.");
    }
    if (input.machineId) {
      const m = await findMachineById(client, input.machineId);
      if (!m || !m.isActive) {
        throw new ValidationError("Selected machine is invalid or inactive.");
      }
    }
    if (input.operatorWorkerId) {
      const w = await findWorkerById(client, input.operatorWorkerId);
      if (!w) {
        throw new ValidationError("Selected worker does not exist.");
      }
    }
  }

  async createDraft(
    input: ProductionLogInput,
    actor: { userId: string }
  ): Promise<ProductionLogDto> {
    const qtyStr = parseQuantityProducedStr(input.quantityProduced);
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      await this.validateReferences(client, input);

      const newId = await insertProductionDraft(client, {
        productionDate: input.productionDate,
        materialId: input.materialId,
        machineId: input.machineId ?? null,
        operatorWorkerId: input.operatorWorkerId ?? null,
        shiftLabel: input.shiftLabel?.trim() || null,
        quantityProduced: qtyStr,
        remarks: input.remarks?.trim() || null,
        enteredByUserId: actor.userId,
      });

      const created = (await findProductionLogById(client, newId))!;
      await insertOperationalHistory(client, {
        recordType: "PRODUCTION_LOG",
        recordId: created.id,
        action: "CREATED",
        fromStatus: null,
        toStatus: "DRAFT",
        actorUserId: actor.userId,
        snapshot: created as unknown as Record<string, unknown>,
      });

      await client.query("COMMIT");
      inTx = false;
      return created;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async updateDraft(
    id: number,
    expectedVersion: number,
    input: ProductionLogInput,
    actor: { userId: string; role: UserRole }
  ): Promise<ProductionLogDto> {
    const qtyStr = parseQuantityProducedStr(input.quantityProduced);
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const current = await findProductionLogById(client, id, true);
      if (!current) throw new NotFoundError("Production log not found.");
      if (
        current.approvalStatus !== "DRAFT" &&
        current.approvalStatus !== "RETURNED_FOR_CORRECTION"
      ) {
        throw new ConflictError(
          `Cannot edit production log in ${current.approvalStatus} status.`
        );
      }
      if (actor.role !== "OWNER" && current.enteredByUserId !== actor.userId) {
        throw new ForbiddenError("Cashiers can only edit their own drafts.");
      }
      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent update detected. Reload first.");
      }

      await this.validateReferences(client, input);

      const ok = await updateProductionDraftRow(client, id, expectedVersion, {
        productionDate: input.productionDate,
        materialId: input.materialId,
        machineId: input.machineId ?? null,
        operatorWorkerId: input.operatorWorkerId ?? null,
        shiftLabel: input.shiftLabel?.trim() || null,
        quantityProduced: qtyStr,
        remarks: input.remarks?.trim() || null,
      });
      if (!ok) throw new ConflictError("Concurrent update detected.");

      const updated = (await findProductionLogById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "PRODUCTION_LOG",
        recordId: id,
        action: "UPDATED_DRAFT",
        fromStatus: current.approvalStatus,
        toStatus: updated.approvalStatus,
        actorUserId: actor.userId,
        snapshot: updated as unknown as Record<string, unknown>,
      });

      await client.query("COMMIT");
      inTx = false;
      return updated;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async submit(
    id: number,
    expectedVersion: number,
    actor: { userId: string; role: UserRole; ipAddress: string }
  ): Promise<ProductionLogDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const current = await findProductionLogById(client, id, true);
      if (!current) throw new NotFoundError("Production log not found.");
      if (
        current.approvalStatus !== "DRAFT" &&
        current.approvalStatus !== "RETURNED_FOR_CORRECTION"
      ) {
        throw new ConflictError(
          `Production log #${id} cannot be submitted from ${current.approvalStatus}.`
        );
      }
      if (actor.role !== "OWNER" && current.enteredByUserId !== actor.userId) {
        throw new ForbiddenError("Cashiers can only submit their own drafts.");
      }
      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent update detected.");
      }

      const ok = await transitionProductionStatus(client, {
        id,
        expectedVersion,
        nextStatus: "SUBMITTED",
      });
      if (!ok) throw new ConflictError("Concurrent update detected.");

      const updated = (await findProductionLogById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "PRODUCTION_LOG",
        recordId: id,
        action: "SUBMITTED",
        fromStatus: current.approvalStatus,
        toStatus: "SUBMITTED",
        actorUserId: actor.userId,
        snapshot: updated as unknown as Record<string, unknown>,
      });

      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action: "SUBMIT_PRODUCTION_LOG",
        entityType: "PRODUCTION_LOG",
        entityId: String(id),
        details: {
          productionDate: updated.productionDate,
          materialId: updated.materialId,
          quantityProduced: updated.quantityProduced,
        },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      return updated;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async cancelDraft(
    id: number,
    expectedVersion: number,
    actor: { userId: string; role: UserRole }
  ): Promise<ProductionLogDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const current = await findProductionLogById(client, id, true);
      if (!current) throw new NotFoundError("Production log not found.");
      if (
        current.approvalStatus !== "DRAFT" &&
        current.approvalStatus !== "RETURNED_FOR_CORRECTION"
      ) {
        throw new ConflictError("Cannot cancel non-draft production log.");
      }
      if (actor.role !== "OWNER" && current.enteredByUserId !== actor.userId) {
        throw new ForbiddenError("Cannot cancel another user's draft.");
      }
      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent update detected.");
      }

      await transitionProductionStatus(client, {
        id,
        expectedVersion,
        nextStatus: "CANCELLED",
      });
      const updated = (await findProductionLogById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "PRODUCTION_LOG",
        recordId: id,
        action: "CANCELLED",
        fromStatus: current.approvalStatus,
        toStatus: "CANCELLED",
        actorUserId: actor.userId,
        snapshot: updated as unknown as Record<string, unknown>,
      });

      await client.query("COMMIT");
      inTx = false;
      return updated;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async review(
    id: number,
    input: {
      decision: "APPROVED" | "RETURNED_FOR_CORRECTION";
      reason?: string | null;
      expectedVersion: number;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<ProductionLogDto> {
    if (
      input.decision === "RETURNED_FOR_CORRECTION" &&
      (!input.reason || input.reason.trim().length < 5)
    ) {
      throw new ValidationError(
        "A reason (min 5 characters) is required when returning a production log."
      );
    }

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const current = await findProductionLogById(client, id, true);
      if (!current) throw new NotFoundError("Production log not found.");
      if (current.approvalStatus !== "SUBMITTED") {
        throw new ConflictError("Production log must be SUBMITTED before review.");
      }
      if (current.version !== input.expectedVersion) {
        throw new ConflictError("Concurrent review conflict.");
      }

      const ok = await transitionProductionStatus(client, {
        id,
        expectedVersion: input.expectedVersion,
        nextStatus: input.decision,
        reviewerOwnerId: actor.ownerUserId,
        reason: input.reason?.trim() || null,
      });
      if (!ok) throw new ConflictError("Concurrent review conflict.");

      const updated = (await findProductionLogById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "PRODUCTION_LOG",
        recordId: id,
        action: input.decision,
        fromStatus: "SUBMITTED",
        toStatus: input.decision,
        actorUserId: actor.ownerUserId,
        reason: input.reason?.trim() || null,
        snapshot: updated as unknown as Record<string, unknown>,
      });

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action:
          input.decision === "APPROVED"
            ? "APPROVE_PRODUCTION_LOG"
            : "RETURN_PRODUCTION_LOG",
        entityType: "PRODUCTION_LOG",
        entityId: String(id),
        details: { reason: input.reason?.trim() || null },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      return updated;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

