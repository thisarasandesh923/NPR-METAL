import type { Pool } from "pg";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../errors/appError.js";
import { formatScaledDecimal, parseScaledDecimal } from "../../utils/money.js";
import {
  computeIntervalSpanMinutes,
  minutesToDecimalHours,
  normalizeTimeString,
  rangesOverlap,
  toAbsoluteMinuteRange,
} from "../../utils/time.js";
import {
  insertOperationalHistory,
  type OperationalApprovalStatus,
} from "../approvals/approvals.repository.js";
import { insertAuthAuditLog } from "../auth/auth.repository.js";
import type { UserRole } from "../auth/auth.types.js";
import { findWorkerById } from "../workers/workers.repository.js";
import {
  findAdjacentMachineIntervals,
  findMachineById,
  findMachineWorkLogById,
  insertMachine,
  insertMachineWorkLogDraft,
  listMachines,
  listMachineWorkLogs,
  transitionMachineWorkLogStatus,
  updateMachineRow,
  updateMachineWorkLogDraftRow,
} from "./machines.repository.js";
import type {
  MachineDto,
  MachineWorkLogDto,
  MachineWorkLogInput,
} from "./machines.types.js";

function parseScheduledHoursStr(
  raw: string | number | null | undefined
): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  let scaled: bigint;
  try {
    scaled = parseScaledDecimal(raw, 2, "Scheduled hours");
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : "Invalid scheduled hours."
    );
  }
  if (scaled <= 0n || scaled > 2400n) {
    throw new ValidationError(
      "Scheduled hours must be greater than 0.00 and at most 24.00."
    );
  }
  return formatScaledDecimal(scaled, 2);
}

export class MachinesService {
  constructor(private readonly pool: Pool) {}

  async getMachines(includeInactive = false): Promise<MachineDto[]> {
    return listMachines(this.pool, includeInactive);
  }

  async createMachine(
    input: {
      machineCode: string;
      machineName: string;
      machineType: string;
      description?: string | null;
      isActive?: boolean;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<MachineDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const created = await insertMachine(client, {
        machineCode: input.machineCode.trim().toUpperCase(),
        machineName: input.machineName.trim(),
        machineType: input.machineType.trim(),
        description: input.description?.trim() || null,
        isActive: input.isActive ?? true,
        createdByUserId: actor.ownerUserId,
      });

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "CREATE_MACHINE",
        entityType: "MACHINE",
        entityId: String(created.id),
        details: {
          machineCode: created.machineCode,
          machineType: created.machineType,
        },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      return created;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      if ((err as { code?: string })?.code === "23505") {
        throw new ConflictError("Machine code already exists.");
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async updateMachine(
    machineId: number,
    input: {
      machineName: string;
      machineType: string;
      description?: string | null;
      isActive: boolean;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<MachineDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const updated = await updateMachineRow(client, machineId, {
        machineName: input.machineName.trim(),
        machineType: input.machineType.trim(),
        description: input.description?.trim() || null,
        isActive: input.isActive,
      });
      if (!updated) throw new NotFoundError("Machine not found.");

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "UPDATE_MACHINE",
        entityType: "MACHINE",
        entityId: String(machineId),
        details: { isActive: updated.isActive },
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

  async listLogs(filters: {
    dateFrom?: string;
    dateTo?: string;
    machineId?: number;
    status?: OperationalApprovalStatus;
  }): Promise<MachineWorkLogDto[]> {
    return listMachineWorkLogs(this.pool, filters);
  }

  private validateAndComputeLog(input: MachineWorkLogInput) {
    let spanMin: number;
    try {
      spanMin = computeIntervalSpanMinutes(
        input.startTime,
        input.endTime,
        input.crossesMidnight
      );
    } catch (err) {
      throw new ValidationError(
        err instanceof Error ? err.message : "Invalid machine operating times."
      );
    }

    if (input.downtimeMinutes < 0 || input.downtimeMinutes > spanMin) {
      throw new ValidationError(
        "Downtime cannot be negative or exceed the total shift duration."
      );
    }

    if (input.downtimeMinutes > 0 && !input.downtimeReason?.trim()) {
      throw new ValidationError(
        "Downtime reason is required whenever downtime minutes are greater than zero."
      );
    }

    const netMin = spanMin - input.downtimeMinutes;
    return {
      startTime: normalizeTimeString(input.startTime, "Start time"),
      endTime: normalizeTimeString(input.endTime, "End time"),
      netOperatingHours: minutesToDecimalHours(netMin),
      scheduledHours: parseScheduledHoursStr(input.scheduledHours),
      absRange: toAbsoluteMinuteRange(
        input.workDate,
        input.startTime,
        input.endTime,
        input.crossesMidnight
      ),
    };
  }

  async createLogDraft(
    input: MachineWorkLogInput,
    actor: { userId: string }
  ): Promise<MachineWorkLogDto> {
    const computed = this.validateAndComputeLog(input);
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`machine_log:${input.machineId}`]
      );

      const machine = await findMachineById(client, input.machineId);
      if (!machine || !machine.isActive) {
        throw new ValidationError("Selected machine is invalid or inactive.");
      }

      if (input.operatorWorkerId) {
        const op = await findWorkerById(client, input.operatorWorkerId);
        if (!op) throw new ValidationError("Selected operator worker does not exist.");
      }

      const existing = await findAdjacentMachineIntervals(
        client,
        input.machineId,
        input.workDate
      );
      for (const row of existing) {
        const other = toAbsoluteMinuteRange(
          row.workDate,
          row.startTime,
          row.endTime,
          row.crossesMidnight
        );
        if (rangesOverlap(computed.absRange, other)) {
          throw new ConflictError(
            `Machine already has an overlapping work log (#${row.id} on ${row.workDate}).`
          );
        }
      }

      const newId = await insertMachineWorkLogDraft(client, {
        workDate: input.workDate,
        machineId: input.machineId,
        operatorWorkerId: input.operatorWorkerId ?? null,
        startTime: computed.startTime,
        endTime: computed.endTime,
        crossesMidnight: input.crossesMidnight,
        downtimeMinutes: input.downtimeMinutes,
        downtimeReason: input.downtimeReason?.trim() || null,
        netOperatingHours: computed.netOperatingHours,
        scheduledHours: computed.scheduledHours,
        remarks: input.remarks?.trim() || null,
        enteredByUserId: actor.userId,
      });

      const created = (await findMachineWorkLogById(client, newId))!;
      await insertOperationalHistory(client, {
        recordType: "MACHINE_LOG",
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

  async updateLogDraft(
    id: number,
    expectedVersion: number,
    input: MachineWorkLogInput,
    actor: { userId: string; role: UserRole }
  ): Promise<MachineWorkLogDto> {
    const computed = this.validateAndComputeLog(input);
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const current = await findMachineWorkLogById(client, id, true);
      if (!current) throw new NotFoundError("Machine work log not found.");
      if (
        current.approvalStatus !== "DRAFT" &&
        current.approvalStatus !== "RETURNED_FOR_CORRECTION"
      ) {
        throw new ConflictError(
          `Cannot edit machine log in ${current.approvalStatus} status.`
        );
      }
      if (actor.role !== "OWNER" && current.enteredByUserId !== actor.userId) {
        throw new ForbiddenError("Cashiers can only edit their own drafts.");
      }
      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent update detected. Reload first.");
      }

      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`machine_log:${input.machineId}`]
      );

      const machine = await findMachineById(client, input.machineId);
      if (!machine || !machine.isActive) {
        throw new ValidationError("Selected machine is invalid or inactive.");
      }

      const existing = await findAdjacentMachineIntervals(
        client,
        input.machineId,
        input.workDate,
        id
      );
      for (const row of existing) {
        const other = toAbsoluteMinuteRange(
          row.workDate,
          row.startTime,
          row.endTime,
          row.crossesMidnight
        );
        if (rangesOverlap(computed.absRange, other)) {
          throw new ConflictError(
            `Machine already has an overlapping work log (#${row.id} on ${row.workDate}).`
          );
        }
      }

      const ok = await updateMachineWorkLogDraftRow(client, id, expectedVersion, {
        workDate: input.workDate,
        machineId: input.machineId,
        operatorWorkerId: input.operatorWorkerId ?? null,
        startTime: computed.startTime,
        endTime: computed.endTime,
        crossesMidnight: input.crossesMidnight,
        downtimeMinutes: input.downtimeMinutes,
        downtimeReason: input.downtimeReason?.trim() || null,
        netOperatingHours: computed.netOperatingHours,
        scheduledHours: computed.scheduledHours,
        remarks: input.remarks?.trim() || null,
      });
      if (!ok) throw new ConflictError("Concurrent update detected.");

      const updated = (await findMachineWorkLogById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "MACHINE_LOG",
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

  async submitLog(
    id: number,
    expectedVersion: number,
    actor: { userId: string; role: UserRole; ipAddress: string }
  ): Promise<MachineWorkLogDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const current = await findMachineWorkLogById(client, id, true);
      if (!current) throw new NotFoundError("Machine work log not found.");
      if (
        current.approvalStatus !== "DRAFT" &&
        current.approvalStatus !== "RETURNED_FOR_CORRECTION"
      ) {
        throw new ConflictError(
          `Machine log #${id} cannot be submitted from ${current.approvalStatus}.`
        );
      }
      if (actor.role !== "OWNER" && current.enteredByUserId !== actor.userId) {
        throw new ForbiddenError("Cashiers can only submit their own drafts.");
      }
      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent update detected.");
      }

      const ok = await transitionMachineWorkLogStatus(client, {
        id,
        expectedVersion,
        nextStatus: "SUBMITTED",
      });
      if (!ok) throw new ConflictError("Concurrent update detected.");

      const updated = (await findMachineWorkLogById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "MACHINE_LOG",
        recordId: id,
        action: "SUBMITTED",
        fromStatus: current.approvalStatus,
        toStatus: "SUBMITTED",
        actorUserId: actor.userId,
        snapshot: updated as unknown as Record<string, unknown>,
      });

      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action: "SUBMIT_MACHINE_LOG",
        entityType: "MACHINE_LOG",
        entityId: String(id),
        details: { workDate: updated.workDate, machineId: updated.machineId },
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

  async cancelLogDraft(
    id: number,
    expectedVersion: number,
    actor: { userId: string; role: UserRole }
  ): Promise<MachineWorkLogDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const current = await findMachineWorkLogById(client, id, true);
      if (!current) throw new NotFoundError("Machine work log not found.");
      if (
        current.approvalStatus !== "DRAFT" &&
        current.approvalStatus !== "RETURNED_FOR_CORRECTION"
      ) {
        throw new ConflictError("Cannot cancel non-draft machine log.");
      }
      if (actor.role !== "OWNER" && current.enteredByUserId !== actor.userId) {
        throw new ForbiddenError("Cannot cancel another user's draft.");
      }
      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent update detected.");
      }

      await transitionMachineWorkLogStatus(client, {
        id,
        expectedVersion,
        nextStatus: "CANCELLED",
      });
      const updated = (await findMachineWorkLogById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "MACHINE_LOG",
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

  async reviewLog(
    id: number,
    input: {
      decision: "APPROVED" | "RETURNED_FOR_CORRECTION";
      reason?: string | null;
      expectedVersion: number;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<MachineWorkLogDto> {
    if (
      input.decision === "RETURNED_FOR_CORRECTION" &&
      (!input.reason || input.reason.trim().length < 5)
    ) {
      throw new ValidationError(
        "A reason (min 5 characters) is required when returning a machine log."
      );
    }

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const current = await findMachineWorkLogById(client, id, true);
      if (!current) throw new NotFoundError("Machine work log not found.");
      if (current.approvalStatus !== "SUBMITTED") {
        throw new ConflictError("Machine log must be SUBMITTED before review.");
      }
      if (current.version !== input.expectedVersion) {
        throw new ConflictError("Concurrent review conflict.");
      }

      const ok = await transitionMachineWorkLogStatus(client, {
        id,
        expectedVersion: input.expectedVersion,
        nextStatus: input.decision,
        reviewerOwnerId: actor.ownerUserId,
        reason: input.reason?.trim() || null,
      });
      if (!ok) throw new ConflictError("Concurrent review conflict.");

      const updated = (await findMachineWorkLogById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "MACHINE_LOG",
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
            ? "APPROVE_MACHINE_LOG"
            : "RETURN_MACHINE_LOG",
        entityType: "MACHINE_LOG",
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

