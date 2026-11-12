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
import {
  findAdjacentWorkerAttendanceIntervals,
  findAttendanceById,
  findWorkerById,
  insertAttendanceDraft,
  listAttendanceRecords,
  listWorkers,
  transitionAttendanceStatus,
  updateAttendanceDraftRow,
  insertWorker,
  updateWorkerRow,
} from "./workers.repository.js";
import type {
  AttendanceInput,
  EmploymentStatus,
  WorkerAttendanceDto,
  WorkerDto,
} from "./workers.types.js";

function parseOvertimeHoursStr(
  raw: string | number,
  workedHoursStr: string
): string {
  let otHundredths: bigint;
  try {
    otHundredths = parseScaledDecimal(raw, 2, "Overtime hours");
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : "Invalid overtime hours."
    );
  }
  const workedHundredths = parseScaledDecimal(workedHoursStr, 2, "Hours worked");
  if (otHundredths < 0n || otHundredths > workedHundredths) {
    throw new ValidationError(
      "Overtime hours cannot exceed total hours worked."
    );
  }
  return formatScaledDecimal(otHundredths, 2);
}

export class WorkersService {
  constructor(private readonly pool: Pool) {}

  async getWorkers(includeInactive = false): Promise<WorkerDto[]> {
    return listWorkers(this.pool, includeInactive);
  }

  async createWorker(
    input: {
      workerCode: string;
      fullName: string;
      phone?: string | null;
      designation: string;
      joinedDate?: string | null;
      employmentStatus?: EmploymentStatus;
      notes?: string | null;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<WorkerDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const created = await insertWorker(client, {
        workerCode: input.workerCode.trim().toUpperCase(),
        fullName: input.fullName.trim(),
        phone: input.phone?.trim() || null,
        designation: input.designation.trim(),
        joinedDate: input.joinedDate || null,
        employmentStatus: input.employmentStatus ?? "ACTIVE",
        notes: input.notes?.trim() || null,
        createdByUserId: actor.ownerUserId,
      });

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "CREATE_WORKER",
        entityType: "WORKER",
        entityId: String(created.id),
        details: { workerCode: created.workerCode, fullName: created.fullName },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      return created;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      if ((err as { code?: string })?.code === "23505") {
        throw new ConflictError("Worker code already exists.");
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async updateWorker(
    workerId: number,
    input: {
      fullName: string;
      phone?: string | null;
      designation: string;
      joinedDate?: string | null;
      employmentStatus: EmploymentStatus;
      notes?: string | null;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<WorkerDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const updated = await updateWorkerRow(client, workerId, {
        fullName: input.fullName.trim(),
        phone: input.phone?.trim() || null,
        designation: input.designation.trim(),
        joinedDate: input.joinedDate || null,
        employmentStatus: input.employmentStatus,
        notes: input.notes?.trim() || null,
      });
      if (!updated) {
        throw new NotFoundError("Worker not found.");
      }

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "UPDATE_WORKER",
        entityType: "WORKER",
        entityId: String(workerId),
        details: { employmentStatus: updated.employmentStatus },
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

  async listAttendance(filters: {
    dateFrom?: string;
    dateTo?: string;
    workerId?: number;
    status?: OperationalApprovalStatus;
  }): Promise<WorkerAttendanceDto[]> {
    return listAttendanceRecords(this.pool, filters);
  }

  private validateAndComputeAttendance(input: AttendanceInput) {
    let spanMin: number;
    try {
      spanMin = computeIntervalSpanMinutes(
        input.startTime,
        input.endTime,
        input.crossesMidnight
      );
    } catch (err) {
      throw new ValidationError(
        err instanceof Error ? err.message : "Invalid shift times."
      );
    }

    if (input.breakMinutes < 0 || input.breakMinutes >= spanMin) {
      throw new ValidationError(
        "Break duration must be non-negative and strictly less than total shift length."
      );
    }

    const netMin = spanMin - input.breakMinutes;
    const hoursWorked = minutesToDecimalHours(netMin);
    const overtimeHours = parseOvertimeHoursStr(
      input.overtimeHours,
      hoursWorked
    );

    return {
      startTime: normalizeTimeString(input.startTime, "Start time"),
      endTime: normalizeTimeString(input.endTime, "End time"),
      hoursWorked,
      overtimeHours,
      absRange: toAbsoluteMinuteRange(
        input.workDate,
        input.startTime,
        input.endTime,
        input.crossesMidnight
      ),
    };
  }

  async createAttendanceDraft(
    input: AttendanceInput,
    actor: { userId: string; ipAddress: string }
  ): Promise<WorkerAttendanceDto> {
    const computed = this.validateAndComputeAttendance(input);
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`worker_att:${input.workerId}`]
      );

      const worker = await findWorkerById(client, input.workerId);
      if (!worker || worker.employmentStatus !== "ACTIVE") {
        throw new ValidationError("Selected worker is missing or not active.");
      }

      const existing = await findAdjacentWorkerAttendanceIntervals(
        client,
        input.workerId,
        input.workDate
      );
      for (const row of existing) {
        const otherRange = toAbsoluteMinuteRange(
          row.workDate,
          row.startTime,
          row.endTime,
          row.crossesMidnight
        );
        if (rangesOverlap(computed.absRange, otherRange)) {
          throw new ConflictError(
            `Worker already has an overlapping attendance record (#${row.id} on ${row.workDate}).`
          );
        }
      }

      const newId = await insertAttendanceDraft(client, {
        workDate: input.workDate,
        workerId: input.workerId,
        startTime: computed.startTime,
        endTime: computed.endTime,
        crossesMidnight: input.crossesMidnight,
        breakMinutes: input.breakMinutes,
        hoursWorked: computed.hoursWorked,
        overtimeHours: computed.overtimeHours,
        remarks: input.remarks?.trim() || null,
        enteredByUserId: actor.userId,
      });

      const created = await findAttendanceById(client, newId);
      if (!created) throw new Error("Inserted attendance record missing.");

      await insertOperationalHistory(client, {
        recordType: "ATTENDANCE",
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

  async updateAttendanceDraft(
    id: number,
    expectedVersion: number,
    input: AttendanceInput,
    actor: { userId: string; role: UserRole }
  ): Promise<WorkerAttendanceDto> {
    const computed = this.validateAndComputeAttendance(input);
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const current = await findAttendanceById(client, id, true);
      if (!current) {
        throw new NotFoundError("Attendance record not found.");
      }

      if (
        current.approvalStatus !== "DRAFT" &&
        current.approvalStatus !== "RETURNED_FOR_CORRECTION"
      ) {
        throw new ConflictError(
          `Cannot edit attendance record in ${current.approvalStatus} status.`
        );
      }

      if (
        actor.role !== "OWNER" &&
        current.enteredByUserId !== actor.userId
      ) {
        throw new ForbiddenError(
          "Cashiers can only edit their own attendance drafts."
        );
      }

      if (current.version !== expectedVersion) {
        throw new ConflictError(
          "Attendance record was modified concurrently. Reload and retry."
        );
      }

      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`worker_att:${input.workerId}`]
      );

      const worker = await findWorkerById(client, input.workerId);
      if (!worker || worker.employmentStatus !== "ACTIVE") {
        throw new ValidationError("Selected worker is missing or not active.");
      }

      const existing = await findAdjacentWorkerAttendanceIntervals(
        client,
        input.workerId,
        input.workDate,
        id
      );
      for (const row of existing) {
        const otherRange = toAbsoluteMinuteRange(
          row.workDate,
          row.startTime,
          row.endTime,
          row.crossesMidnight
        );
        if (rangesOverlap(computed.absRange, otherRange)) {
          throw new ConflictError(
            `Worker already has an overlapping attendance record (#${row.id} on ${row.workDate}).`
          );
        }
      }

      const ok = await updateAttendanceDraftRow(client, id, expectedVersion, {
        workDate: input.workDate,
        workerId: input.workerId,
        startTime: computed.startTime,
        endTime: computed.endTime,
        crossesMidnight: input.crossesMidnight,
        breakMinutes: input.breakMinutes,
        hoursWorked: computed.hoursWorked,
        overtimeHours: computed.overtimeHours,
        remarks: input.remarks?.trim() || null,
      });
      if (!ok) {
        throw new ConflictError("Concurrent attendance update detected.");
      }

      const updated = (await findAttendanceById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "ATTENDANCE",
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

  async submitAttendance(
    id: number,
    expectedVersion: number,
    actor: { userId: string; role: UserRole; ipAddress: string }
  ): Promise<WorkerAttendanceDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const current = await findAttendanceById(client, id, true);
      if (!current) throw new NotFoundError("Attendance record not found.");

      if (
        current.approvalStatus !== "DRAFT" &&
        current.approvalStatus !== "RETURNED_FOR_CORRECTION"
      ) {
        throw new ConflictError(
          `Attendance record #${id} cannot be submitted from ${current.approvalStatus}.`
        );
      }

      if (
        actor.role !== "OWNER" &&
        current.enteredByUserId !== actor.userId
      ) {
        throw new ForbiddenError(
          "Cashiers can only submit their own attendance entries."
        );
      }

      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent update detected. Reload first.");
      }

      const ok = await transitionAttendanceStatus(client, {
        id,
        expectedVersion,
        nextStatus: "SUBMITTED",
      });
      if (!ok) throw new ConflictError("Concurrent update detected.");

      const updated = (await findAttendanceById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "ATTENDANCE",
        recordId: id,
        action: "SUBMITTED",
        fromStatus: current.approvalStatus,
        toStatus: "SUBMITTED",
        actorUserId: actor.userId,
        snapshot: updated as unknown as Record<string, unknown>,
      });

      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action: "SUBMIT_ATTENDANCE",
        entityType: "ATTENDANCE",
        entityId: String(id),
        details: { workDate: updated.workDate, workerId: updated.workerId },
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

  async cancelAttendanceDraft(
    id: number,
    expectedVersion: number,
    actor: { userId: string; role: UserRole }
  ): Promise<WorkerAttendanceDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const current = await findAttendanceById(client, id, true);
      if (!current) throw new NotFoundError("Attendance record not found.");
      if (
        current.approvalStatus !== "DRAFT" &&
        current.approvalStatus !== "RETURNED_FOR_CORRECTION"
      ) {
        throw new ConflictError(
          `Cannot cancel record in ${current.approvalStatus} status.`
        );
      }
      if (actor.role !== "OWNER" && current.enteredByUserId !== actor.userId) {
        throw new ForbiddenError("Cannot cancel another staff member's draft.");
      }
      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent update detected.");
      }

      await transitionAttendanceStatus(client, {
        id,
        expectedVersion,
        nextStatus: "CANCELLED",
      });
      const updated = (await findAttendanceById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "ATTENDANCE",
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

  async reviewAttendance(
    id: number,
    input: {
      decision: "APPROVED" | "RETURNED_FOR_CORRECTION";
      reason?: string | null;
      expectedVersion: number;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<WorkerAttendanceDto> {
    if (
      input.decision === "RETURNED_FOR_CORRECTION" &&
      (!input.reason || input.reason.trim().length < 5)
    ) {
      throw new ValidationError(
        "A reason (min 5 characters) is required when returning attendance for correction."
      );
    }

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const current = await findAttendanceById(client, id, true);
      if (!current) throw new NotFoundError("Attendance record not found.");

      if (current.approvalStatus !== "SUBMITTED") {
        throw new ConflictError(
          `Attendance record #${id} must be SUBMITTED before review (current: ${current.approvalStatus}).`
        );
      }
      if (current.version !== input.expectedVersion) {
        throw new ConflictError(
          "Attendance record was already reviewed or changed concurrently."
        );
      }

      const ok = await transitionAttendanceStatus(client, {
        id,
        expectedVersion: input.expectedVersion,
        nextStatus: input.decision,
        reviewerOwnerId: actor.ownerUserId,
        reason: input.reason?.trim() || null,
      });
      if (!ok) {
        throw new ConflictError("Concurrent review conflict.");
      }

      const updated = (await findAttendanceById(client, id))!;
      await insertOperationalHistory(client, {
        recordType: "ATTENDANCE",
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
            ? "APPROVE_ATTENDANCE"
            : "RETURN_ATTENDANCE",
        entityType: "ATTENDANCE",
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

