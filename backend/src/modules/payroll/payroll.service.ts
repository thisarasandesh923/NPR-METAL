import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  ConflictError,
  NotFoundError,
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
  findPayrollEntryById,
  findPayrollPeriodById,
  insertPayrollPeriod,
  listCompensationProfiles,
  listOperationalExpenses,
  listPayrollEntriesByPeriod,
  listPayrollPeriods,
  listSalaryPayments,
  listWorkerAdvances,
  upsertCompensationProfileRow,
} from "./payroll.repository.js";
import type {
  CalculationMode,
  CompensationProfileDto,
  OperationalExpenseDto,
  PayArrangement,
  PayrollEntryDto,
  PayrollPeriodDto,
  SalaryPaymentDto,
  WorkerAdvanceDto,
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
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<CompensationProfileDto> {
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

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const worker = await findWorkerById(client, input.workerId);
      if (!worker) throw new NotFoundError("Worker not found.");

      await upsertCompensationProfileRow(client, {
        workerId: input.workerId,
        payArrangement: input.payArrangement,
        baseRate: baseRateStr,
        overtimeHourlyRate: otRateStr,
        effectiveFrom: input.effectiveFrom,
        notes: input.notes?.trim() || null,
        ownerUserId: actor.ownerUserId,
      });

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "UPSERT_COMPENSATION",
        entityType: "WORKER_COMPENSATION",
        entityId: String(input.workerId),
        details: { payArrangement: input.payArrangement },
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
    actor: { ownerUserId: string }
  ): Promise<PayrollPeriodDto> {
    if (input.endDate < input.startDate) {
      throw new ValidationError("endDate must be on or after startDate.");
    }
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;
      const created = await insertPayrollPeriod(client, {
        periodLabel: input.periodLabel.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        notes: input.notes?.trim() || null,
        ownerUserId: actor.ownerUserId,
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

  async getAdvances(workerId?: number): Promise<WorkerAdvanceDto[]> {
    return listWorkerAdvances(this.pool, workerId);
  }

  async recordAdvance(
    input: {
      workerId: number;
      advanceDate: string;
      amount: string | number;
      reason: string;
      idempotencyKey: string;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<{ advance: WorkerAdvanceDto; replayed: boolean }> {
    const amountCents = parseMoneyRequired(input.amount, "Advance amount");
    if (amountCents <= 0n) {
      throw new ValidationError("Advance amount must be greater than Rs. 0.00.");
    }
    const amountStr = formatScaledDecimal(amountCents, 2);
    const reqHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: actor.ownerUserId,
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
            existing.actor_user_id !== actor.ownerUserId ||
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
          actor.ownerUserId,
          input.idempotencyKey,
        ]
      );

      const newId = Number(ins.rows[0].id);
      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "RECORD_WORKER_ADVANCE",
        entityType: "WORKER_ADVANCE",
        entityId: String(newId),
        details: { workerId: input.workerId, amount: amountStr },
        ipAddress: actor.ipAddress,
      });

      const list = await listWorkerAdvances(client, input.workerId);
      const created = list.find((a) => a.id === newId)!;
      await insertIdempotencyRecord(client, {
        idempotencyKey: input.idempotencyKey,
        operationType: "RECORD_WORKER_ADVANCE",
        requestHash: reqHash,
        actorUserId: actor.ownerUserId,
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
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<{
    payment: SalaryPaymentDto;
    entry: PayrollEntryDto;
    replayed: boolean;
  }> {
    const amountCents = parseMoneyRequired(input.amount, "Salary payment amount");
    if (amountCents <= 0n) {
      throw new ValidationError("Salary payment must be greater than Rs. 0.00.");
    }
    const amountStr = formatScaledDecimal(amountCents, 2);
    const reqHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: actor.ownerUserId,
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
            existing.actor_user_id !== actor.ownerUserId ||
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
          actor.ownerUserId,
          input.idempotencyKey,
        ]
      );

      const newId = Number(ins.rows[0].id);
      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "RECORD_SALARY_PAYMENT",
        entityType: "SALARY_PAYMENT",
        entityId: String(newId),
        details: {
          payrollEntryId: entry.id,
          workerId: entry.workerId,
          amount: amountStr,
        },
        ipAddress: actor.ipAddress,
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
        actorUserId: actor.ownerUserId,
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

  async getExpenses(filters?: {
    dateFrom?: string;
    dateTo?: string;
  }): Promise<OperationalExpenseDto[]> {
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
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<{ expense: OperationalExpenseDto; replayed: boolean }> {
    const amountCents = parseMoneyRequired(input.amount, "Expense amount");
    if (amountCents <= 0n) {
      throw new ValidationError("Expense amount must be greater than Rs. 0.00.");
    }
    const amountStr = formatScaledDecimal(amountCents, 2);
    const reqHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: actor.ownerUserId,
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
            existing.actor_user_id !== actor.ownerUserId ||
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
          actor.ownerUserId,
          input.idempotencyKey,
        ]
      );

      const newId = Number(ins.rows[0].id);
      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "RECORD_EXPENSE",
        entityType: "OPERATIONAL_EXPENSE",
        entityId: String(newId),
        details: { category: input.category.trim(), amount: amountStr },
        ipAddress: actor.ipAddress,
      });

      const list = await listOperationalExpenses(client);
      const created = list.find((e) => e.id === newId)!;
      await insertIdempotencyRecord(client, {
        idempotencyKey: input.idempotencyKey,
        operationType: "RECORD_EXPENSE",
        requestHash: reqHash,
        actorUserId: actor.ownerUserId,
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

