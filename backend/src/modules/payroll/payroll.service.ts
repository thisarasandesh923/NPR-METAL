import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../errors/appError.js";
import {
  computeLineTotalCents,
  formatScaledDecimal,
  parseScaledDecimal,
} from "../../utils/money.js";
import { insertAuthAuditLog } from "../auth/auth.repository.js";
import {
  acquireIdempotencyLock,
  deleteExpiredIdempotencyRecord,
  findIdempotencyRecord,
  insertIdempotencyRecord,
} from "../invoices/invoices.repository.js";
import { findWorkerById } from "../workers/workers.repository.js";
import {
  calculateAdvancesForWorkerInPeriod,
  findCompensationProfileByWorkerId,
  findLatestSalaryPaymentAdjustment,
  findOverlappingPayrollPeriod,
  findPayrollEntryById,
  findPayrollPeriodById,
  findSalaryPaymentById,
  initializePeriodManualEntries,
  insertPayrollPeriod,
  insertSalaryPaymentAdjustment,
  listCompensationHistory,
  listCompensationProfiles,
  listOperationalExpenses,
  listPayrollEntriesByPeriod,
  listPayrollPeriods,
  listSalaryAuditHistory,
  listSalaryPaymentAdjustments,
  listSalaryPayments,
  listWorkerAdvances,
  updateApprovedSalaryEntry,
  updateManualSalaryEntry,
  upsertCompensationProfileRow,
} from "./payroll.repository.js";
import type {
  AdjustSalaryPaymentInput,
  CalculationMode,
  CompensationHistoryDto,
  CompensationHistoryFilters,
  CompensationProfileDto,
  OperationalExpenseDto,
  OperationalExpenseFilters,
  PayArrangement,
  PayrollEntryDto,
  PayrollPeriodDto,
  SalaryAdjustmentType,
  SalaryAuditHistoryDto,
  SalaryAuditHistoryFilters,
  SalaryPaymentAdjustmentDto,
  SalaryPaymentDto,
  UpdateApprovedSalaryInput,
  UpdateManualSalaryInput,
  WorkerAdvanceDto,
  WorkerAdvanceFilters,
} from "./payroll.types.js";

function parseMoneyNullable(
  raw: string | number | null | undefined,
  field: string
): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  let cents: bigint;
  try {
    cents = parseScaledDecimal(raw, 2, field);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : `Invalid ${field}.`);
  }
  return formatScaledDecimal(cents, 2);
}

function parseMoneyRequired(raw: string | number, field: string): bigint {
  try {
    return parseScaledDecimal(raw, 2, field);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : `Invalid ${field}.`);
  }
}

export class PayrollService {
  constructor(private readonly pool: Pool) {}

  async getCompensationProfiles(): Promise<CompensationProfileDto[]> {
    return listCompensationProfiles(this.pool);
  }

  async upsertCompensationProfile(
    input: {
      workerId: number;
      payArrangement: PayArrangement;
      baseRate?: string | number | null;
      overtimeHourlyRate?: string | number | null;
      effectiveFrom: string;
      notes?: string | null;
      reason?: string;
      expectedVersion?: number;
    },
    actor: {
      userId?: string;
      ownerUserId?: string;
      username?: string;
      role?: string;
      ipAddress: string;
    }
  ): Promise<CompensationProfileDto> {
    const actorUserId = actor.userId ?? actor.ownerUserId;
    if (!actorUserId) {
      throw new ValidationError("User identifier is required.");
    }

    const baseRateStr = parseMoneyNullable(input.baseRate, "Base rate");
    const otRateStr = parseMoneyNullable(
      input.overtimeHourlyRate,
      "Overtime hourly rate"
    );

    if (input.payArrangement !== "MANUAL" && baseRateStr === null) {
      throw new ValidationError(
        `Base rate is required for ${input.payArrangement} pay arrangement.`
      );
    }

    const reason = input.reason?.trim() || "";
    if (reason.length < 5) {
      throw new ValidationError(
        "Please provide a business reason for this rate change (at least 5 characters)."
      );
    }

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const worker = await findWorkerById(client, input.workerId);
      if (!worker) throw new NotFoundError("Worker not found.");

      const current = await findCompensationProfileByWorkerId(
        client,
        input.workerId
      );
      if (
        current &&
        input.expectedVersion !== undefined &&
        current.version !== input.expectedVersion
      ) {
        throw new ConflictError(
          "This worker compensation profile was modified by another session. Please reload before saving.",
          "VERSION_CONFLICT"
        );
      }

      const oldPayArrangement = current ? current.payArrangement : null;
      const oldBaseRate = current ? current.baseRate : null;
      const oldOvertimeHourlyRate = current ? current.overtimeHourlyRate : null;

      await upsertCompensationProfileRow(client, {
        workerId: input.workerId,
        payArrangement: input.payArrangement,
        baseRate: baseRateStr,
        overtimeHourlyRate: otRateStr,
        effectiveFrom: input.effectiveFrom,
        notes: input.notes?.trim() || null,
        ownerUserId: actorUserId,
      });

      await insertAuthAuditLog(client, {
        userId: actorUserId,
        action: "UPSERT_COMPENSATION",
        entityType: "WORKER_COMPENSATION",
        entityId: String(input.workerId),
        details: {
          workerId: input.workerId,
          workerCode: worker.workerCode,
          fullName: worker.fullName,
          oldPayArrangement,
          newPayArrangement: input.payArrangement,
          oldBaseRate,
          newBaseRate: baseRateStr,
          oldOvertimeHourlyRate,
          newOvertimeHourlyRate: otRateStr,
          reason,
          effectiveFrom: input.effectiveFrom,
          actorUsername: actor.username ?? null,
          actorRole: actor.role ?? null,
        },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      const all = await listCompensationProfiles(this.pool);
      return all.find((p) => p.workerId === input.workerId)!;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getCompensationHistory(
    filters?: CompensationHistoryFilters
  ): Promise<CompensationHistoryDto[]> {
    return listCompensationHistory(this.pool, filters);
  }

  async getPeriods(): Promise<PayrollPeriodDto[]> {
    return listPayrollPeriods(this.pool);
  }

  async createPeriod(
    input: {
      periodLabel: string;
      startDate: string;
      endDate: string;
      notes?: string | null;
    },
    actor: {
      userId?: string;
      ownerUserId?: string;
      username?: string;
      role?: string;
      fullName?: string;
      ipAddress?: string;
    }
  ): Promise<PayrollPeriodDto> {
    const actorUserId = actor.userId ?? actor.ownerUserId;
    if (!actorUserId) throw new UnauthorizedError();

    if (input.endDate < input.startDate) {
      throw new ValidationError("endDate must be on or after startDate.");
    }
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const overlap = await findOverlappingPayrollPeriod(
        client,
        input.startDate,
        input.endDate
      );
      if (overlap) {
        throw new ConflictError(
          `Payroll period dates overlap with existing period "${overlap.periodLabel}" (${overlap.startDate} to ${overlap.endDate}). Non-overlapping periods are required to prevent double advance deductions.`
        );
      }

      const newId = await insertPayrollPeriod(client, {
        periodLabel: input.periodLabel.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        notes: input.notes?.trim() || null,
        createdByUserId: actorUserId,
      });

      // Auto-initialize DRAFT manual salary entries for all active workers
      await initializePeriodManualEntries(
        client,
        newId,
        input.startDate,
        input.endDate
      );

      await insertAuthAuditLog(client, {
        userId: actorUserId,
        action: "CREATE_PAYROLL_PERIOD",
        entityType: "PAYROLL_PERIOD",
        entityId: String(newId),
        details: {
          periodLabel: input.periodLabel.trim(),
          startDate: input.startDate,
          endDate: input.endDate,
          actorUsername: actor.username,
          actorRole: actor.role,
        },
        ipAddress: actor.ipAddress ?? null,
      });

      const created = (await findPayrollPeriodById(client, newId))!;
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

  async initializeManualPeriodDrafts(
    periodId: number,
    _actor: { userId: string }
  ): Promise<PayrollEntryDto[]> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const period = await findPayrollPeriodById(client, periodId, true);
      if (!period) throw new NotFoundError("Payroll period not found.");
      if (period.status !== "DRAFT") {
        throw new ConflictError(
          `Only DRAFT payroll periods can be initialized. This period is ${period.status}.`
        );
      }
      await initializePeriodManualEntries(
        client,
        periodId,
        period.startDate,
        period.endDate
      );
      await client.query("COMMIT");
      inTx = false;
      return listPayrollEntriesByPeriod(this.pool, periodId);
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getEntriesForPeriod(periodId: number): Promise<PayrollEntryDto[]> {
    return listPayrollEntriesByPeriod(this.pool, periodId);
  }

  /**
   * Generates or refreshes DRAFT payroll entries from APPROVED attendance records
   * and configured compensation profiles without inventing unconfigured rules.
   */
  async preparePeriodDrafts(
    periodId: number,
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<PayrollEntryDto[]> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const period = await findPayrollPeriodById(client, periodId, true);
      if (!period) throw new NotFoundError("Payroll period not found.");
      if (period.status !== "DRAFT") {
        throw new ConflictError("Only DRAFT payroll periods can be regenerated.");
      }

      const workersRes = await client.query<{
        id: string | number;
        pay_arrangement: PayArrangement | null;
        base_rate: string | null;
        overtime_hourly_rate: string | null;
      }>(
        `SELECT
           w.id,
           cp.pay_arrangement,
           cp.base_rate::text AS base_rate,
           cp.overtime_hourly_rate::text AS overtime_hourly_rate
         FROM public.workers w
         LEFT JOIN public.worker_compensation_profiles cp ON cp.worker_id = w.id
         WHERE w.employment_status = 'ACTIVE'`
      );

      for (const w of workersRes.rows) {
        const workerId = Number(w.id);

        const attAggRes = await client.query<{
          days_count: number;
          total_hours: string;
          ot_hours: string;
        }>(
          `SELECT
             COUNT(DISTINCT work_date)::int AS days_count,
             COALESCE(SUM(hours_worked), 0.00)::NUMERIC(8, 2)::text AS total_hours,
             COALESCE(SUM(overtime_hours), 0.00)::NUMERIC(8, 2)::text AS ot_hours
           FROM public.worker_attendance
           WHERE worker_id = $1
             AND approval_status = 'APPROVED'
             AND work_date BETWEEN $2::date AND $3::date`,
          [workerId, period.startDate, period.endDate]
        );

        const advAggRes = await client.query<{ adv_total: string }>(
          `SELECT COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2)::text AS adv_total
           FROM public.worker_advances
           WHERE worker_id = $1
             AND advance_date BETWEEN $2::date AND $3::date`,
          [workerId, period.startDate, period.endDate]
        );

        const daysCount = attAggRes.rows[0].days_count;
        const totalHoursHundredths = parseScaledDecimal(
          attAggRes.rows[0].total_hours,
          2,
          "Total hours"
        );
        const otHoursHundredths = parseScaledDecimal(
          attAggRes.rows[0].ot_hours,
          2,
          "Overtime hours"
        );
        const regularHoursHundredths =
          totalHoursHundredths >= otHoursHundredths
            ? totalHoursHundredths - otHoursHundredths
            : 0n;

        const arrangement: PayArrangement = w.pay_arrangement ?? "MANUAL";
        let mode: CalculationMode = "OWNER_MANUAL_DRAFT";
        let basePayCents = 0n;
        let otPayCents = 0n;
        let noteParts: string[] = [];

        if (arrangement === "HOURLY" && w.base_rate !== null) {
          const hourlyRateCents = parseScaledDecimal(w.base_rate, 2, "Base rate");
          // hours are scale 2 -> convert scale 2 hours to scale 3 (x10) for computeLineTotalCents
          basePayCents = computeLineTotalCents(
            regularHoursHundredths * 10n,
            hourlyRateCents
          );
          if (otHoursHundredths > 0n) {
            if (w.overtime_hourly_rate !== null) {
              const otRateCents = parseScaledDecimal(
                w.overtime_hourly_rate,
                2,
                "OT rate"
              );
              otPayCents = computeLineTotalCents(
                otHoursHundredths * 10n,
                otRateCents
              );
              mode = "CONFIGURED_AUTO";
            } else {
              mode = "OWNER_MANUAL_DRAFT";
              noteParts.push(
                "Overtime hours recorded without an explicit OT hourly rate; Owner must review overtime pay."
              );
            }
          } else {
            mode = "CONFIGURED_AUTO";
          }
        } else if (arrangement === "DAILY" && w.base_rate !== null) {
          const dailyRateCents = parseScaledDecimal(w.base_rate, 2, "Daily rate");
          basePayCents = BigInt(daysCount) * dailyRateCents;
          if (otHoursHundredths > 0n) {
            if (w.overtime_hourly_rate !== null) {
              const otRateCents = parseScaledDecimal(
                w.overtime_hourly_rate,
                2,
                "OT rate"
              );
              otPayCents = computeLineTotalCents(
                otHoursHundredths * 10n,
                otRateCents
              );
              mode = "CONFIGURED_AUTO";
            } else {
              mode = "OWNER_MANUAL_DRAFT";
              noteParts.push(
                "Overtime hours recorded without explicit OT rate; Owner must review."
              );
            }
          } else {
            mode = "CONFIGURED_AUTO";
          }
        } else {
          mode = "OWNER_MANUAL_DRAFT";
          noteParts.push(
            arrangement === "MONTHLY"
              ? "Monthly proration/salary rules require explicit Owner draft review."
              : "Manual pay arrangement; Owner must specify payable components."
          );
        }

        const advCents = parseScaledDecimal(
          advAggRes.rows[0].adv_total,
          2,
          "Advance total"
        );
        const grossCents = basePayCents + otPayCents;
        const netCents = grossCents > advCents ? grossCents - advCents : 0n;

        // Upsert strictly on DRAFT entries (never overwrite already-APPROVED entries)
        await client.query(
          `INSERT INTO public.payroll_entries (
             payroll_period_id, worker_id, pay_arrangement_snapshot, calculation_mode,
             approved_days_count, approved_regular_hours, approved_overtime_hours,
             base_pay, overtime_pay, allowances, deductions, advance_deduction,
             gross_pay, net_payable, status, notes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0.00, 0.00, $10, $11, $12, 'DRAFT', $13)
           ON CONFLICT (payroll_period_id, worker_id) DO UPDATE SET
             pay_arrangement_snapshot = EXCLUDED.pay_arrangement_snapshot,
             calculation_mode = EXCLUDED.calculation_mode,
             approved_days_count = EXCLUDED.approved_days_count,
             approved_regular_hours = EXCLUDED.approved_regular_hours,
             approved_overtime_hours = EXCLUDED.approved_overtime_hours,
             base_pay = EXCLUDED.base_pay,
             overtime_pay = EXCLUDED.overtime_pay,
             advance_deduction = EXCLUDED.advance_deduction,
             gross_pay = EXCLUDED.gross_pay,
             net_payable = GREATEST(ROUND((EXCLUDED.base_pay + EXCLUDED.overtime_pay + public.payroll_entries.allowances) - public.payroll_entries.deductions - EXCLUDED.advance_deduction, 2), 0.00),
             notes = EXCLUDED.notes,
             version = public.payroll_entries.version + 1
           WHERE public.payroll_entries.status = 'DRAFT'`,
          [
            periodId,
            workerId,
            arrangement,
            mode,
            daysCount,
            formatScaledDecimal(regularHoursHundredths, 2),
            formatScaledDecimal(otHoursHundredths, 2),
            formatScaledDecimal(basePayCents, 2),
            formatScaledDecimal(otPayCents, 2),
            formatScaledDecimal(advCents, 2),
            formatScaledDecimal(grossCents, 2),
            formatScaledDecimal(netCents, 2),
            noteParts.join(" ") || null,
          ]
        );
      }

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "PREPARE_PAYROLL_DRAFTS",
        entityType: "PAYROLL_PERIOD",
        entityId: String(periodId),
        details: { periodLabel: period.periodLabel },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      return listPayrollEntriesByPeriod(this.pool, periodId);
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async updateDraftEntry(
    entryId: number,
    expectedVersion: number,
    input: {
      basePay: string | number;
      overtimePay: string | number;
      allowances: string | number;
      deductions: string | number;
      advanceDeduction: string | number;
      notes?: string | null;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<PayrollEntryDto> {
    const baseCents = parseMoneyRequired(input.basePay, "Base pay");
    const otCents = parseMoneyRequired(input.overtimePay, "Overtime pay");
    const allowCents = parseMoneyRequired(input.allowances, "Allowances");
    const dedCents = parseMoneyRequired(input.deductions, "Deductions");
    const advCents = parseMoneyRequired(
      input.advanceDeduction,
      "Advance deduction"
    );

    const grossCents = baseCents + otCents + allowCents;
    const totalDedCents = dedCents + advCents;
    const netCents = grossCents > totalDedCents ? grossCents - totalDedCents : 0n;

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const current = await findPayrollEntryById(client, entryId, true);
      if (!current) throw new NotFoundError("Payroll entry not found.");
      if (current.status !== "DRAFT") {
        throw new ConflictError("Only DRAFT payroll entries can be modified.");
      }
      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent payroll update detected.");
      }

      await client.query(
        `UPDATE public.payroll_entries
         SET base_pay = $1,
             overtime_pay = $2,
             allowances = $3,
             deductions = $4,
             advance_deduction = $5,
             gross_pay = $6,
             net_payable = $7,
             notes = $8,
             version = version + 1
         WHERE id = $9 AND version = $10`,
        [
          formatScaledDecimal(baseCents, 2),
          formatScaledDecimal(otCents, 2),
          formatScaledDecimal(allowCents, 2),
          formatScaledDecimal(dedCents, 2),
          formatScaledDecimal(advCents, 2),
          formatScaledDecimal(grossCents, 2),
          formatScaledDecimal(netCents, 2),
          input.notes?.trim() || null,
          entryId,
          expectedVersion,
        ]
      );

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "UPDATE_PAYROLL_DRAFT",
        entityType: "PAYROLL_ENTRY",
        entityId: String(entryId),
        details: { netPayable: formatScaledDecimal(netCents, 2) },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      return (await findPayrollEntryById(this.pool, entryId))!;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async updateManualSalary(
    entryId: number,
    input: UpdateManualSalaryInput,
    actor: {
      userId: string;
      username: string;
      role: string;
      fullName?: string;
      ipAddress: string;
    }
  ): Promise<PayrollEntryDto> {
    const trimmedReason = input.reason?.trim() ?? "";
    if (trimmedReason.length < 5) {
      throw new ValidationError("A business reason of at least 5 characters is mandatory for manual salary changes.");
    }

    let grossCents: bigint;
    try {
      grossCents = parseScaledDecimal(String(input.grossSalary), 2, "grossSalary");
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : "Invalid grossSalary.");
    }
    if (grossCents < 0n) {
      throw new ValidationError("grossSalary must be a non-negative amount.");
    }
    const grossStr = formatScaledDecimal(grossCents, 2);

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const current = await findPayrollEntryById(client, entryId, true);
      if (!current) throw new NotFoundError("Payroll entry not found.");

      if (current.status !== "DRAFT") {
        throw new ConflictError(
          `Cannot modify salary for an entry with status ${current.status}. Only DRAFT entries can be edited.`
        );
      }

      if (current.version !== input.expectedVersion) {
        throw new ConflictError(
          "Concurrent modification conflict: this payroll entry was updated by another user. Please reload and try again."
        );
      }

      const period = await findPayrollPeriodById(client, current.payrollPeriodId, true);
      if (!period) throw new NotFoundError("Payroll period not found.");

      // Recalculate advances within period dates
      const advStr = await calculateAdvancesForWorkerInPeriod(
        client,
        current.workerId,
        period.startDate,
        period.endDate
      );
      const advCents = parseScaledDecimal(advStr, 2, "advances");

      // Formula: Net Salary = Manual Gross Salary - Applicable Advances
      const netCents = grossCents >= advCents ? grossCents - advCents : 0n;
      const netStr = formatScaledDecimal(netCents, 2);

      const excessCents = advCents > grossCents ? advCents - grossCents : 0n;
      const excessStr = excessCents > 0n ? formatScaledDecimal(excessCents, 2) : null;

      const excessNotice = excessStr
        ? ` [NOTICE: Applicable advances of Rs. ${formatScaledDecimal(advCents, 2)} exceed gross salary of Rs. ${grossStr} by Rs. ${excessStr}]`
        : "";
      const baseNotes = input.notes?.trim() ?? "";
      const combinedNotes = [baseNotes, excessNotice.trim()].filter(Boolean).join(" ") || null;

      const updated = await updateManualSalaryEntry(client, {
        entryId,
        expectedVersion: input.expectedVersion,
        grossSalary: grossStr,
        advanceDeduction: advStr,
        netPayable: netStr,
        notes: combinedNotes,
      });

      if (!updated) {
        throw new ConflictError(
          "Concurrent modification conflict: entry version changed during update."
        );
      }

      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action: "UPDATE_MANUAL_SALARY",
        entityType: "payroll_entry",
        entityId: String(entryId),
        details: {
          payrollEntryId: entryId,
          workerId: current.workerId,
          workerCode: current.workerCode,
          workerName: current.workerName,
          periodId: period.id,
          periodLabel: period.periodLabel,
          previousGrossSalary: current.grossPay,
          newGrossSalary: grossStr,
          applicableAdvances: advStr,
          calculatedNetPayable: netStr,
          excessAdvances: excessStr,
          reason: trimmedReason,
          notes: input.notes?.trim() || null,
          actorUserId: actor.userId,
          actorUsername: actor.username,
          actorRole: actor.role,
          actorName: actor.fullName ?? actor.username,
        },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;

      return (await findPayrollEntryById(this.pool, entryId))!;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async updateApprovedSalary(
    entryId: number,
    input: UpdateApprovedSalaryInput,
    actor: {
      userId: string;
      username: string;
      role: string;
      fullName?: string;
      ipAddress?: string;
    }
  ): Promise<PayrollEntryDto> {
    const trimmedReason = input.reason.trim();
    if (trimmedReason.length < 5) {
      throw new ValidationError("Business reason must be at least 5 characters.");
    }

    let grossCents: bigint;
    try {
      grossCents = parseScaledDecimal(input.newGrossSalary, 2, "newGrossSalary");
    } catch (err: any) {
      throw new ValidationError(err.message || "Invalid gross salary.");
    }

    if (grossCents <= 0n) {
      throw new ValidationError("Gross salary must be greater than Rs. 0.00.");
    }
    const grossStr = formatScaledDecimal(grossCents, 2);

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      // Hierarchical row lock on payroll entry
      const current = await findPayrollEntryById(client, entryId, true);
      if (!current) throw new NotFoundError("Payroll entry not found.");

      if (current.status !== "APPROVED") {
        throw new ConflictError(
          `Cannot modify approved salary for an entry with status ${current.status}. Only APPROVED entries can be corrected.`
        );
      }

      if (current.version !== input.expectedVersion) {
        throw new ConflictError(
          "Concurrent modification conflict: this payroll entry was updated by another user. Please reload and try again."
        );
      }

      const period = await findPayrollPeriodById(client, current.payrollPeriodId, true);
      if (!period) throw new NotFoundError("Payroll period not found.");
      if (period.status === "CLOSED") {
        throw new ConflictError("Cannot modify approved salary in a CLOSED payroll period.");
      }

      // Recalculate advances within period dates
      const advStr = await calculateAdvancesForWorkerInPeriod(
        client,
        current.workerId,
        period.startDate,
        period.endDate
      );
      const advCents = parseScaledDecimal(advStr, 2, "advances");

      // Block corrections where advances exceed gross salary
      if (advCents > grossCents) {
        const excessStr = formatScaledDecimal(advCents - grossCents, 2);
        throw new ValidationError(
          `Applicable salary advances (Rs. ${formatScaledDecimal(advCents, 2)}) exceed proposed gross salary (Rs. ${grossStr}) by Rs. ${excessStr}. Approved salary cannot be less than advances.`
        );
      }

      // Formula: Net Salary = Manual Gross Salary - Applicable Advances
      const netCents = grossCents - advCents;
      const netStr = formatScaledDecimal(netCents, 2);

      // Block corrections that reduce net payable below already paid effective amount
      const paidCents = parseScaledDecimal(current.paidAmount, 2, "paidAmount");
      if (netCents < paidCents) {
        throw new ConflictError(
          `Proposed net salary (Rs. ${netStr}) cannot be reduced below the effective amount already paid out (Rs. ${current.paidAmount}). Please void or adjust payments first.`
        );
      }

      const notes = input.notes?.trim() || null;
      const updated = await updateApprovedSalaryEntry(client, {
        entryId,
        expectedVersion: input.expectedVersion,
        grossSalary: grossStr,
        advanceDeduction: advStr,
        netPayable: netStr,
        notes,
      });

      if (!updated) {
        throw new ConflictError(
          "Concurrent modification conflict: entry version changed during update."
        );
      }

      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action: "UPDATE_APPROVED_SALARY",
        entityType: "PAYROLL_ENTRY",
        entityId: String(entryId),
        details: {
          payrollEntryId: entryId,
          workerId: current.workerId,
          workerCode: current.workerCode,
          workerName: current.workerName,
          periodId: period.id,
          periodLabel: period.periodLabel,
          previousGrossSalary: current.grossPay,
          newGrossSalary: grossStr,
          previousNetPayable: current.netPayable,
          newNetPayable: netStr,
          applicableAdvances: advStr,
          paidAmount: current.paidAmount,
          remainingPayable: formatScaledDecimal(netCents - paidCents, 2),
          reason: trimmedReason,
          notes,
          actorUserId: actor.userId,
          actorUsername: actor.username,
          actorRole: actor.role,
          actorName: actor.fullName ?? actor.username,
        },
        ipAddress: actor.ipAddress ?? null,
      });

      const result = (await findPayrollEntryById(client, entryId))!;
      await client.query("COMMIT");
      inTx = false;
      return result;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async approvePayrollEntry(
    entryId: number,
    expectedVersion: number,
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<PayrollEntryDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const current = await findPayrollEntryById(client, entryId, true);
      if (!current) throw new NotFoundError("Payroll entry not found.");
      if (current.status !== "DRAFT") {
        throw new ConflictError(
          `Payroll entry is already ${current.status}.`
        );
      }
      if (current.version !== expectedVersion) {
        throw new ConflictError("Concurrent approval conflict.");
      }

      // Check gross salary is positive
      const grossCents = parseScaledDecimal(current.grossPay, 2, "grossPay");
      if (grossCents <= 0n) {
        throw new ValidationError(
          "Cannot approve payroll entry: manual gross salary must be greater than zero."
        );
      }

      // Live recalculation of advances for this period to verify snapshot accuracy
      const period = await findPayrollPeriodById(client, current.payrollPeriodId, true);
      if (!period) throw new NotFoundError("Payroll period not found.");

      const liveAdvStr = await calculateAdvancesForWorkerInPeriod(
        client,
        current.workerId,
        period.startDate,
        period.endDate
      );
      const liveAdvCents = parseScaledDecimal(liveAdvStr, 2, "liveAdvances");
      const draftAdvCents = parseScaledDecimal(current.advanceDeduction, 2, "draftAdvances");

      if (liveAdvCents !== draftAdvCents) {
        throw new ConflictError(
          `Applicable salary advances have changed since this draft was saved (was Rs. ${current.advanceDeduction}, now Rs. ${liveAdvStr}). Please update the salary draft to re-synchronize advances before approving.`
        );
      }

      // Requirement 8: If advances exceed gross salary, block final approval with exact excess
      if (liveAdvCents > grossCents) {
        const excessCents = liveAdvCents - grossCents;
        const grossFmt = formatScaledDecimal(grossCents, 2);
        const advFmt = formatScaledDecimal(liveAdvCents, 2);
        const excessFmt = formatScaledDecimal(excessCents, 2);
        throw new ValidationError(
          `Cannot approve payroll entry: applicable advances (Rs. ${advFmt}) exceed gross salary (Rs. ${grossFmt}) by Rs. ${excessFmt}. Manual settlement or adjustment is required before approval.`
        );
      }

      await client.query(
        `UPDATE public.payroll_entries
         SET status = 'APPROVED',
             approved_by_owner_id = $1,
             approved_at = NOW(),
             version = version + 1
         WHERE id = $2 AND version = $3`,
        [actor.ownerUserId, entryId, expectedVersion]
      );

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "APPROVE_PAYROLL_ENTRY",
        entityType: "PAYROLL_ENTRY",
        entityId: String(entryId),
        details: {
          workerId: current.workerId,
          grossPay: current.grossPay,
          advanceDeduction: current.advanceDeduction,
          netPayable: current.netPayable,
        },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      return (await findPayrollEntryById(this.pool, entryId))!;
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getSalaryAuditHistory(
    filters: SalaryAuditHistoryFilters = {}
  ): Promise<SalaryAuditHistoryDto[]> {
    return listSalaryAuditHistory(this.pool, filters);
  }

  async getAdvances(
    filters?: WorkerAdvanceFilters | number
  ): Promise<WorkerAdvanceDto[]> {
    return listWorkerAdvances(this.pool, filters);
  }

  async recordAdvance(
    input: {
      workerId: number;
      advanceDate: string;
      amount: string | number;
      reason: string;
      idempotencyKey: string;
    },
    actor: {
      userId?: string;
      ownerUserId?: string;
      username?: string;
      role?: string;
      ipAddress: string;
    }
  ): Promise<{ advance: WorkerAdvanceDto; replayed: boolean }> {
    const actorUserId = actor.userId ?? actor.ownerUserId;
    if (!actorUserId) {
      throw new ValidationError("User identifier is required.");
    }
    const amountCents = parseMoneyRequired(input.amount, "Advance amount");
    if (amountCents <= 0n) {
      throw new ValidationError("Advance amount must be greater than Rs. 0.00.");
    }
    const amountStr = formatScaledDecimal(amountCents, 2);
    const reqHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: actorUserId,
          workerId: input.workerId,
          advanceDate: input.advanceDate,
          amountStr,
          reason: input.reason.trim(),
        })
      )
      .digest("hex");

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      await acquireIdempotencyLock(client, "ADVANCE", input.idempotencyKey);
      const existing = await findIdempotencyRecord(client, input.idempotencyKey);
      if (existing) {
        if (existing.expires_at.getTime() <= Date.now()) {
          await deleteExpiredIdempotencyRecord(client, input.idempotencyKey);
        } else {
          if (
            existing.operation_type !== "RECORD_WORKER_ADVANCE" ||
            existing.actor_user_id !== actorUserId ||
            existing.request_hash !== reqHash
          ) {
            throw new ConflictError("Idempotency key conflict.");
          }
          await client.query("COMMIT");
          inTx = false;
          return {
            advance: (existing.response_payload as { advance: WorkerAdvanceDto })
              .advance,
            replayed: true,
          };
        }
      }

      const worker = await findWorkerById(client, input.workerId);
      if (!worker) throw new NotFoundError("Worker not found.");

      const ins = await client.query<{ id: string | number }>(
        `INSERT INTO public.worker_advances (
           worker_id, advance_date, amount, reason, authorized_by_owner_id, idempotency_key
         ) VALUES ($1, $2::date, $3, $4, $5, $6)
         RETURNING id`,
        [
          input.workerId,
          input.advanceDate,
          amountStr,
          input.reason.trim(),
          actorUserId,
          input.idempotencyKey,
        ]
      );

      const newId = Number(ins.rows[0].id);
      await insertAuthAuditLog(client, {
        userId: actorUserId,
        action: "RECORD_WORKER_ADVANCE",
        entityType: "WORKER_ADVANCE",
        entityId: String(newId),
        details: {
          workerId: input.workerId,
          workerCode: worker.workerCode,
          workerName: worker.fullName,
          amount: amountStr,
          reason: input.reason.trim(),
          actorUsername: actor.username ?? null,
          actorRole: actor.role ?? null,
        },
        ipAddress: actor.ipAddress,
      });

      const list = await listWorkerAdvances(client, input.workerId);
      const created = list.find((a) => a.id === newId)!;
      await insertIdempotencyRecord(client, {
        idempotencyKey: input.idempotencyKey,
        operationType: "RECORD_WORKER_ADVANCE",
        requestHash: reqHash,
        actorUserId: actorUserId,
        responseStatus: 201,
        responsePayload: { advance: created },
      });

      await client.query("COMMIT");
      inTx = false;
      return { advance: created, replayed: false };
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getSalaryPayments(filters?: {
    periodId?: number;
    workerId?: number;
  }): Promise<SalaryPaymentDto[]> {
    return listSalaryPayments(this.pool, filters);
  }

  async recordSalaryPayment(
    input: {
      payrollEntryId: number;
      paymentDate: string;
      amount: string | number;
      paymentMethod: "CASH" | "BANK_TRANSFER";
      referenceNote?: string | null;
      idempotencyKey: string;
    },
    actor: {
      userId?: string;
      ownerUserId?: string;
      username?: string;
      role?: string;
      fullName?: string;
      ipAddress?: string;
    }
  ): Promise<{
    payment: SalaryPaymentDto;
    entry: PayrollEntryDto;
    replayed: boolean;
  }> {
    const actorUserId = actor.userId ?? actor.ownerUserId;
    if (!actorUserId) throw new UnauthorizedError();

    if (input.paymentMethod !== "CASH") {
      throw new ValidationError("Salary payments must strictly use CASH payment method.");
    }

    const amountCents = parseMoneyRequired(input.amount, "Salary payment amount");
    if (amountCents <= 0n) {
      throw new ValidationError("Salary payment must be greater than Rs. 0.00.");
    }
    const amountStr = formatScaledDecimal(amountCents, 2);
    const reqHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: actorUserId,
          payrollEntryId: input.payrollEntryId,
          paymentDate: input.paymentDate,
          amountStr,
          paymentMethod: input.paymentMethod,
          referenceNote: input.referenceNote?.trim() || null,
        })
      )
      .digest("hex");

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      await acquireIdempotencyLock(client, "SAL_PAY", input.idempotencyKey);
      const existing = await findIdempotencyRecord(client, input.idempotencyKey);
      if (existing) {
        if (existing.expires_at.getTime() <= Date.now()) {
          await deleteExpiredIdempotencyRecord(client, input.idempotencyKey);
        } else {
          if (
            existing.operation_type !== "RECORD_SALARY_PAYMENT" ||
            existing.actor_user_id !== actorUserId ||
            existing.request_hash !== reqHash
          ) {
            throw new ConflictError("Idempotency key conflict.");
          }
          const payload = existing.response_payload as {
            payment: SalaryPaymentDto;
            entry: PayrollEntryDto;
          };
          await client.query("COMMIT");
          inTx = false;
          return { ...payload, replayed: true };
        }
      }

      const entry = await findPayrollEntryById(client, input.payrollEntryId, true);
      if (!entry) throw new NotFoundError("Payroll entry not found.");
      if (entry.status !== "APPROVED") {
        throw new ConflictError(
          "Salary payments can only be recorded against APPROVED payroll entries."
        );
      }

      const remainingCents = parseScaledDecimal(
        entry.remainingPayable,
        2,
        "Remaining payable"
      );
      if (remainingCents <= 0n) {
        throw new ConflictError("This payroll entry is already fully paid.");
      }
      if (amountCents > remainingCents) {
        throw new ValidationError(
          `Salary payment exceeds remaining net payable (Rs. ${entry.remainingPayable}).`
        );
      }

      const ins = await client.query<{ id: string | number }>(
        `INSERT INTO public.salary_payments (
           payroll_entry_id, worker_id, payment_date, amount,
           payment_method, reference_note, paid_by_owner_id, idempotency_key
         ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          entry.id,
          entry.workerId,
          input.paymentDate,
          amountStr,
          input.paymentMethod,
          input.referenceNote?.trim() || null,
          actorUserId,
          input.idempotencyKey,
        ]
      );

      const newId = Number(ins.rows[0].id);
      await insertAuthAuditLog(client, {
        userId: actorUserId,
        action: "RECORD_SALARY_PAYMENT",
        entityType: "SALARY_PAYMENT",
        entityId: String(newId),
        details: {
          payrollEntryId: entry.id,
          workerId: entry.workerId,
          amount: amountStr,
          paymentMethod: input.paymentMethod,
          actorUsername: actor.username,
          actorRole: actor.role,
        },
        ipAddress: actor.ipAddress ?? null,
      });

      const updatedEntry = (await findPayrollEntryById(client, entry.id))!;
      const paymentsList = await listSalaryPayments(client, {
        workerId: entry.workerId,
      });
      const createdPayment = paymentsList.find((p) => p.id === newId)!;

      const responsePayload = { payment: createdPayment, entry: updatedEntry };
      await insertIdempotencyRecord(client, {
        idempotencyKey: input.idempotencyKey,
        operationType: "RECORD_SALARY_PAYMENT",
        requestHash: reqHash,
        actorUserId: actorUserId,
        responseStatus: 201,
        responsePayload,
      });

      await client.query("COMMIT");
      inTx = false;
      return { ...responsePayload, replayed: false };
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async adjustSalaryPayment(
    paymentId: number,
    input: AdjustSalaryPaymentInput,
    actor: {
      userId: string;
      username: string;
      role: string;
      fullName?: string;
      ipAddress?: string;
    }
  ): Promise<{
    adjustment: SalaryPaymentAdjustmentDto;
    entry: PayrollEntryDto;
    replayed: boolean;
  }> {
    const trimmedReason = input.reason.trim();
    if (trimmedReason.length < 10) {
      throw new ValidationError(
        "Business reason must be at least 10 characters."
      );
    }

    const trimmedIdemKey = input.idempotencyKey.trim();
    if (trimmedIdemKey.length < 16) {
      throw new ValidationError(
        "Idempotency key must be at least 16 characters."
      );
    }

    let correctedAmountCents: bigint;
    if (input.adjustmentType === "VOID") {
      correctedAmountCents = 0n;
    } else if (input.adjustmentType === "AMOUNT_CORRECTION") {
      if (input.correctedAmount === undefined || input.correctedAmount === null) {
        throw new ValidationError(
          "correctedAmount is required for AMOUNT_CORRECTION adjustment type."
        );
      }
      try {
        correctedAmountCents = parseScaledDecimal(
          input.correctedAmount,
          2,
          "correctedAmount"
        );
      } catch (err: any) {
        throw new ValidationError(err.message || "Invalid corrected amount.");
      }
      if (correctedAmountCents <= 0n) {
        throw new ValidationError(
          "correctedAmount must be greater than Rs. 0.00 for AMOUNT_CORRECTION."
        );
      }
    } else {
      throw new ValidationError(
        `Invalid adjustmentType. Must be VOID or AMOUNT_CORRECTION.`
      );
    }

    const correctedAmountStr = formatScaledDecimal(correctedAmountCents, 2);

    const reqHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: actor.userId,
          salaryPaymentId: paymentId,
          adjustmentType: input.adjustmentType,
          correctedAmount: correctedAmountStr,
          reason: trimmedReason,
        })
      )
      .digest("hex");

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      // 1. Acquire idempotency lock
      await acquireIdempotencyLock(client, "SAL_ADJ", trimmedIdemKey);
      const existing = await findIdempotencyRecord(client, trimmedIdemKey);
      if (existing) {
        if (existing.expires_at.getTime() <= Date.now()) {
          await deleteExpiredIdempotencyRecord(client, trimmedIdemKey);
        } else {
          if (
            existing.operation_type !== "PAYMENT_ADJUSTMENT" ||
            existing.actor_user_id !== actor.userId ||
            existing.request_hash !== reqHash
          ) {
            throw new ConflictError("Idempotency key conflict.");
          }
          const payload = existing.response_payload as {
            adjustment: SalaryPaymentAdjustmentDto;
            entry: PayrollEntryDto;
          };
          await client.query("COMMIT");
          inTx = false;
          return { ...payload, replayed: true };
        }
      }

      // 2. Look up target payment to obtain parent payroll_entry_id
      const initialPayment = await findSalaryPaymentById(client, paymentId, false);
      if (!initialPayment) {
        throw new NotFoundError("Salary payment not found.");
      }

      // 3. HIERARCHICAL LOCK STEP 1: Lock PARENT payroll_entry row first
      const entry = await findPayrollEntryById(client, initialPayment.payrollEntryId, true);
      if (!entry) throw new NotFoundError("Payroll entry not found.");
      if (entry.status !== "APPROVED") {
        throw new ConflictError(
          `Adjustments can only be recorded against APPROVED payroll entries (status: ${entry.status}).`
        );
      }

      // 4. Inspect CHILD salary_payment row under parent entry lock
      // Note: Application-level parent lock on payroll_entries serializes all adjustments.
      // Child row lock on salary_payments is safely executed by the SECURITY DEFINER trigger
      // enforce_salary_payment_adjustment_bounds() without requiring table UPDATE privilege for npr_app_user.
      const lockedPayment = await findSalaryPaymentById(client, paymentId, false);
      if (!lockedPayment) throw new NotFoundError("Salary payment not found.");

      // 5. Inspect prior adjustments for this payment
      const latestAdj = await findLatestSalaryPaymentAdjustment(client, paymentId);
      if (latestAdj && latestAdj.adjustmentType === "VOID") {
        throw new ConflictError(
          `Cannot adjust salary payment ${lockedPayment.salaryReceiptNumber} because it has already been voided.`
        );
      }

      // Current effective amount of this payment before this adjustment
      const priorEffectiveStr = latestAdj
        ? latestAdj.correctedAmount
        : lockedPayment.amount;
      const priorEffectiveCents = parseScaledDecimal(
        priorEffectiveStr,
        2,
        "priorEffectiveAmount"
      );

      // Verify prior effective amount for stale request protection if client sent expectedPriorAmount
      if (input.expectedPriorAmount !== undefined && input.expectedPriorAmount !== null) {
        const expectedPriorCents = parseScaledDecimal(
          input.expectedPriorAmount,
          2,
          "expectedPriorAmount"
        );
        if (expectedPriorCents !== priorEffectiveCents) {
          throw new ConflictError(
            `Payment effective amount has changed (expected Rs. ${formatScaledDecimal(expectedPriorCents, 2)}, current Rs. ${priorEffectiveStr}). Please reload.`
          );
        }
      }

      // For AMOUNT_CORRECTION, corrected amount must differ from prior effective amount
      if (
        input.adjustmentType === "AMOUNT_CORRECTION" &&
        correctedAmountCents === priorEffectiveCents
      ) {
        throw new ValidationError(
          `Corrected amount (Rs. ${correctedAmountStr}) must differ from current effective amount (Rs. ${priorEffectiveStr}).`
        );
      }

      // Calculate adjustment delta: corrected_amount - prior_effective_amount
      const deltaCents = correctedAmountCents - priorEffectiveCents;
      const deltaStr = formatScaledDecimal(deltaCents, 2);

      // Net payable check: calculate current effective paid across all payments on this entry
      const currentPaidCents = parseScaledDecimal(entry.paidAmount, 2, "entry.paidAmount");
      const netPayableCents = parseScaledDecimal(entry.netPayable, 2, "entry.netPayable");
      const projectedPaidCents = currentPaidCents + deltaCents;

      if (projectedPaidCents > netPayableCents) {
        const projPaidStr = formatScaledDecimal(projectedPaidCents, 2);
        throw new ValidationError(
          `Salary payment adjustment causes total paid (Rs. ${projPaidStr}) to exceed net payable (Rs. ${entry.netPayable}).`
        );
      }

      if (projectedPaidCents < 0n) {
        throw new ValidationError(
          "Salary payment adjustment causes total paid to become negative."
        );
      }

      // 6. Insert new adjustment record
      const ins = await insertSalaryPaymentAdjustment(client, {
        salaryPaymentId: lockedPayment.id,
        payrollEntryId: entry.id,
        workerId: entry.workerId,
        adjustmentType: input.adjustmentType,
        priorEffectiveAmount: priorEffectiveStr,
        correctedAmount: correctedAmountStr,
        adjustmentDelta: deltaStr,
        authorizedByOwnerId: actor.userId,
        reason: trimmedReason,
        idempotencyKey: trimmedIdemKey,
      });

      // 7. Insert audit log
      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action:
          input.adjustmentType === "VOID"
            ? "VOID_SALARY_PAYMENT"
            : "CORRECT_SALARY_PAYMENT",
        entityType: "SALARY_PAYMENT_ADJUSTMENT",
        entityId: String(ins.id),
        details: {
          adjustmentId: ins.id,
          adjustmentNumber: ins.adjustmentNumber,
          salaryPaymentId: lockedPayment.id,
          salaryReceiptNumber: lockedPayment.salaryReceiptNumber,
          payrollEntryId: entry.id,
          workerId: entry.workerId,
          workerName: entry.workerName,
          adjustmentType: input.adjustmentType,
          priorEffectiveAmount: priorEffectiveStr,
          correctedAmount: correctedAmountStr,
          adjustmentDelta: deltaStr,
          originalPaymentAmount: lockedPayment.amount,
          originalPaidByOwnerId: lockedPayment.paidByOwnerId,
          reason: trimmedReason,
          actorUserId: actor.userId,
          actorUsername: actor.username,
          actorRole: actor.role,
        },
        ipAddress: actor.ipAddress ?? null,
      });

      // 8. Re-fetch updated entry and created adjustment
      const updatedEntry = (await findPayrollEntryById(client, entry.id))!;
      const adjustments = await listSalaryPaymentAdjustments(client, lockedPayment.id);
      const createdAdjustment = adjustments.find((a) => a.id === ins.id)!;

      const responsePayload = {
        adjustment: createdAdjustment,
        entry: updatedEntry,
      };

      // 9. Record idempotency
      await insertIdempotencyRecord(client, {
        idempotencyKey: trimmedIdemKey,
        operationType: "PAYMENT_ADJUSTMENT",
        requestHash: reqHash,
        actorUserId: actor.userId,
        responseStatus: 201,
        responsePayload,
      });

      await client.query("COMMIT");
      inTx = false;
      return { ...responsePayload, replayed: false };
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getSalaryPaymentAdjustments(
    paymentId: number
  ): Promise<SalaryPaymentAdjustmentDto[]> {
    return listSalaryPaymentAdjustments(this.pool, paymentId);
  }

  async getExpenses(
    filters?: OperationalExpenseFilters
  ): Promise<OperationalExpenseDto[]> {
    return listOperationalExpenses(this.pool, filters);
  }

  async recordExpense(
    input: {
      expenseDate: string;
      category: string;
      description: string;
      amount: string | number;
      idempotencyKey: string;
    },
    actor: {
      userId?: string;
      ownerUserId?: string;
      username?: string;
      role?: string;
      ipAddress: string;
    }
  ): Promise<{ expense: OperationalExpenseDto; replayed: boolean }> {
    const actorUserId = actor.userId ?? actor.ownerUserId;
    if (!actorUserId) {
      throw new ValidationError("User identifier is required.");
    }
    const amountCents = parseMoneyRequired(input.amount, "Expense amount");
    if (amountCents <= 0n) {
      throw new ValidationError("Expense amount must be greater than Rs. 0.00.");
    }
    const amountStr = formatScaledDecimal(amountCents, 2);
    const reqHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: actorUserId,
          expenseDate: input.expenseDate,
          category: input.category.trim(),
          description: input.description.trim(),
          amountStr,
        })
      )
      .digest("hex");

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      await acquireIdempotencyLock(client, "EXPENSE", input.idempotencyKey);
      const existing = await findIdempotencyRecord(client, input.idempotencyKey);
      if (existing) {
        if (existing.expires_at.getTime() <= Date.now()) {
          await deleteExpiredIdempotencyRecord(client, input.idempotencyKey);
        } else {
          if (
            existing.operation_type !== "RECORD_EXPENSE" ||
            existing.actor_user_id !== actorUserId ||
            existing.request_hash !== reqHash
          ) {
            throw new ConflictError("Idempotency key conflict.");
          }
          await client.query("COMMIT");
          inTx = false;
          return {
            expense: (
              existing.response_payload as { expense: OperationalExpenseDto }
            ).expense,
            replayed: true,
          };
        }
      }

      const ins = await client.query<{ id: string | number }>(
        `INSERT INTO public.operational_expenses (
           expense_date, category, description, amount, recorded_by_owner_id, idempotency_key
         ) VALUES ($1::date, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          input.expenseDate,
          input.category.trim(),
          input.description.trim(),
          amountStr,
          actorUserId,
          input.idempotencyKey,
        ]
      );

      const newId = Number(ins.rows[0].id);
      await insertAuthAuditLog(client, {
        userId: actorUserId,
        action: "RECORD_EXPENSE",
        entityType: "OPERATIONAL_EXPENSE",
        entityId: String(newId),
        details: {
          category: input.category.trim(),
          description: input.description.trim(),
          amount: amountStr,
          actorUsername: actor.username ?? null,
          actorRole: actor.role ?? null,
        },
        ipAddress: actor.ipAddress,
      });

      const list = await listOperationalExpenses(client);
      const created = list.find((e) => e.id === newId)!;
      await insertIdempotencyRecord(client, {
        idempotencyKey: input.idempotencyKey,
        operationType: "RECORD_EXPENSE",
        requestHash: reqHash,
        actorUserId: actorUserId,
        responseStatus: 201,
        responsePayload: { expense: created },
      });

      await client.query("COMMIT");
      inTx = false;
      return { expense: created, replayed: false };
    } catch (err) {
      if (inTx) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

