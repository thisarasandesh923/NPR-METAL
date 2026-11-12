import type { Pool, PoolClient } from "pg";
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

export type DbClient = Pool | PoolClient;

function dateStr(v: Date | string | null): string {
  if (!v) return "";
  return typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

export async function listCompensationProfiles(
  client: DbClient
): Promise<CompensationProfileDto[]> {
  const res = await client.query<{
    id: string | number;
    worker_id: string | number;
    worker_code: string;
    worker_name: string;
    designation: string;
    pay_arrangement: PayArrangement;
    base_rate: string | null;
    overtime_hourly_rate: string | null;
    effective_from: string;
    notes: string | null;
    version: number;
    updated_at: Date;
  }>(
    `SELECT
       cp.id, cp.worker_id, w.worker_code, w.full_name AS worker_name, w.designation,
       cp.pay_arrangement, cp.base_rate::text AS base_rate,
       cp.overtime_hourly_rate::text AS overtime_hourly_rate,
       cp.effective_from::text AS effective_from,
       cp.notes, cp.version, cp.updated_at
     FROM public.worker_compensation_profiles cp
     JOIN public.workers w ON w.id = cp.worker_id
     ORDER BY LOWER(w.full_name) ASC`
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    workerId: Number(r.worker_id),
    workerCode: r.worker_code,
    workerName: r.worker_name,
    designation: r.designation,
    payArrangement: r.pay_arrangement,
    baseRate: r.base_rate,
    overtimeHourlyRate: r.overtime_hourly_rate,
    effectiveFrom: dateStr(r.effective_from),
    notes: r.notes,
    version: r.version,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function upsertCompensationProfileRow(
  client: PoolClient,
  params: {
    workerId: number;
    payArrangement: PayArrangement;
    baseRate: string | null;
    overtimeHourlyRate: string | null;
    effectiveFrom: string;
    notes: string | null;
    ownerUserId: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO public.worker_compensation_profiles (
       worker_id, pay_arrangement, base_rate, overtime_hourly_rate,
       effective_from, notes, updated_by_owner_id
     ) VALUES ($1, $2, $3, $4, $5::date, $6, $7)
     ON CONFLICT (worker_id) DO UPDATE SET
       pay_arrangement = EXCLUDED.pay_arrangement,
       base_rate = EXCLUDED.base_rate,
       overtime_hourly_rate = EXCLUDED.overtime_hourly_rate,
       effective_from = EXCLUDED.effective_from,
       notes = EXCLUDED.notes,
       updated_by_owner_id = EXCLUDED.updated_by_owner_id,
       version = public.worker_compensation_profiles.version + 1`,
    [
      params.workerId,
      params.payArrangement,
      params.baseRate,
      params.overtimeHourlyRate,
      params.effectiveFrom,
      params.notes,
      params.ownerUserId,
    ]
  );
}

export async function listPayrollPeriods(
  client: DbClient
): Promise<PayrollPeriodDto[]> {
  const res = await client.query<{
    id: string | number;
    period_label: string;
    start_date: string;
    end_date: string;
    status: "DRAFT" | "APPROVED" | "CLOSED";
    notes: string | null;
    version: number;
    created_at: Date;
  }>(
    `SELECT id, period_label, start_date::text AS start_date, end_date::text AS end_date,
            status, notes, version, created_at
     FROM public.payroll_periods
     ORDER BY start_date DESC, id DESC
     LIMIT 100`
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    periodLabel: r.period_label,
    startDate: dateStr(r.start_date),
    endDate: dateStr(r.end_date),
    status: r.status,
    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function findPayrollPeriodById(
  client: DbClient,
  periodId: number,
  forUpdate = false
): Promise<PayrollPeriodDto | null> {
  const res = await client.query<{
    id: string | number;
    period_label: string;
    start_date: string;
    end_date: string;
    status: "DRAFT" | "APPROVED" | "CLOSED";
    notes: string | null;
    version: number;
    created_at: Date;
  }>(
    `SELECT id, period_label, start_date::text AS start_date, end_date::text AS end_date,
            status, notes, version, created_at
     FROM public.payroll_periods
     WHERE id = $1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [periodId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    periodLabel: r.period_label,
    startDate: dateStr(r.start_date),
    endDate: dateStr(r.end_date),
    status: r.status,
    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
  };
}

export async function insertPayrollPeriod(
  client: PoolClient,
  params: {
    periodLabel: string;
    startDate: string;
    endDate: string;
    notes: string | null;
    ownerUserId: string;
  }
): Promise<PayrollPeriodDto> {
  const res = await client.query<{
    id: string | number;
    period_label: string;
    start_date: string;
    end_date: string;
    status: "DRAFT" | "APPROVED" | "CLOSED";
    notes: string | null;
    version: number;
    created_at: Date;
  }>(
    `INSERT INTO public.payroll_periods (period_label, start_date, end_date, notes, created_by_owner_id)
     VALUES ($1, $2::date, $3::date, $4, $5)
     RETURNING id, period_label, start_date::text AS start_date, end_date::text AS end_date,
               status, notes, version, created_at`,
    [params.periodLabel, params.startDate, params.endDate, params.notes, params.ownerUserId]
  );
  const r = res.rows[0];
  return {
    id: Number(r.id),
    periodLabel: r.period_label,
    startDate: dateStr(r.start_date),
    endDate: dateStr(r.end_date),
    status: r.status,
    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
  };
}

export async function listPayrollEntriesByPeriod(
  client: DbClient,
  periodId: number
): Promise<PayrollEntryDto[]> {
  const res = await client.query<{
    id: string | number;
    payroll_period_id: string | number;
    worker_id: string | number;
    worker_code: string;
    worker_name: string;
    designation: string;
    pay_arrangement_snapshot: PayArrangement;
    calculation_mode: CalculationMode;
    approved_days_count: number;
    approved_regular_hours: string;
    approved_overtime_hours: string;
    base_pay: string;
    overtime_pay: string;
    allowances: string;
    deductions: string;
    advance_deduction: string;
    gross_pay: string;
    net_payable: string;
    paid_amount: string;
    remaining_payable: string;
    status: "DRAFT" | "APPROVED" | "CANCELLED";
    notes: string | null;
    version: number;
    approved_at: Date | null;
  }>(
    `WITH paid_totals AS (
       SELECT payroll_entry_id, COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2) AS paid_amount
       FROM public.salary_payments
       GROUP BY payroll_entry_id
     )
     SELECT
       pe.id, pe.payroll_period_id, pe.worker_id,
       w.worker_code, w.full_name AS worker_name, w.designation,
       pe.pay_arrangement_snapshot, pe.calculation_mode,
       pe.approved_days_count,
       pe.approved_regular_hours::text AS approved_regular_hours,
       pe.approved_overtime_hours::text AS approved_overtime_hours,
       pe.base_pay::text AS base_pay,
       pe.overtime_pay::text AS overtime_pay,
       pe.allowances::text AS allowances,
       pe.deductions::text AS deductions,
       pe.advance_deduction::text AS advance_deduction,
       pe.gross_pay::text AS gross_pay,
       pe.net_payable::text AS net_payable,
       COALESCE(pt.paid_amount, 0.00)::NUMERIC(12, 2)::text AS paid_amount,
       GREATEST(pe.net_payable - COALESCE(pt.paid_amount, 0.00), 0.00)::NUMERIC(12, 2)::text AS remaining_payable,
       pe.status, pe.notes, pe.version, pe.approved_at
     FROM public.payroll_entries pe
     JOIN public.workers w ON w.id = pe.worker_id
     LEFT JOIN paid_totals pt ON pt.payroll_entry_id = pe.id
     WHERE pe.payroll_period_id = $1
     ORDER BY LOWER(w.full_name) ASC`,
    [periodId]
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    payrollPeriodId: Number(r.payroll_period_id),
    workerId: Number(r.worker_id),
    workerCode: r.worker_code,
    workerName: r.worker_name,
    designation: r.designation,
    payArrangementSnapshot: r.pay_arrangement_snapshot,
    calculationMode: r.calculation_mode,
    approvedDaysCount: r.approved_days_count,
    approvedRegularHours: r.approved_regular_hours,
    approvedOvertimeHours: r.approved_overtime_hours,
    basePay: r.base_pay,
    overtimePay: r.overtime_pay,
    allowances: r.allowances,
    deductions: r.deductions,
    advanceDeduction: r.advance_deduction,
    grossPay: r.gross_pay,
    netPayable: r.net_payable,
    paidAmount: r.paid_amount,
    remainingPayable: r.remaining_payable,
    status: r.status,
    notes: r.notes,
    version: r.version,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
  }));
}

export async function findPayrollEntryById(
  client: DbClient,
  entryId: number,
  forUpdate = false
): Promise<PayrollEntryDto | null> {
  const lockSql = forUpdate ? "FOR UPDATE OF pe" : "";
  const res = await client.query<{
    id: string | number;
    payroll_period_id: string | number;
    worker_id: string | number;
    worker_code: string;
    worker_name: string;
    designation: string;
    pay_arrangement_snapshot: PayArrangement;
    calculation_mode: CalculationMode;
    approved_days_count: number;
    approved_regular_hours: string;
    approved_overtime_hours: string;
    base_pay: string;
    overtime_pay: string;
    allowances: string;
    deductions: string;
    advance_deduction: string;
    gross_pay: string;
    net_payable: string;
    paid_amount: string;
    remaining_payable: string;
    status: "DRAFT" | "APPROVED" | "CANCELLED";
    notes: string | null;
    version: number;
    approved_at: Date | null;
  }>(
    `SELECT
       pe.id, pe.payroll_period_id, pe.worker_id,
       w.worker_code, w.full_name AS worker_name, w.designation,
       pe.pay_arrangement_snapshot, pe.calculation_mode,
       pe.approved_days_count,
       pe.approved_regular_hours::text AS approved_regular_hours,
       pe.approved_overtime_hours::text AS approved_overtime_hours,
       pe.base_pay::text AS base_pay,
       pe.overtime_pay::text AS overtime_pay,
       pe.allowances::text AS allowances,
       pe.deductions::text AS deductions,
       pe.advance_deduction::text AS advance_deduction,
       pe.gross_pay::text AS gross_pay,
       pe.net_payable::text AS net_payable,
       COALESCE((SELECT SUM(sp.amount) FROM public.salary_payments sp WHERE sp.payroll_entry_id = pe.id), 0.00)::NUMERIC(12, 2)::text AS paid_amount,
       GREATEST(pe.net_payable - COALESCE((SELECT SUM(sp.amount) FROM public.salary_payments sp WHERE sp.payroll_entry_id = pe.id), 0.00), 0.00)::NUMERIC(12, 2)::text AS remaining_payable,
       pe.status, pe.notes, pe.version, pe.approved_at
     FROM public.payroll_entries pe
     JOIN public.workers w ON w.id = pe.worker_id
     WHERE pe.id = $1
     ${lockSql}`,
    [entryId]
  );

  const r = res.rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    payrollPeriodId: Number(r.payroll_period_id),
    workerId: Number(r.worker_id),
    workerCode: r.worker_code,
    workerName: r.worker_name,
    designation: r.designation,
    payArrangementSnapshot: r.pay_arrangement_snapshot,
    calculationMode: r.calculation_mode,
    approvedDaysCount: r.approved_days_count,
    approvedRegularHours: r.approved_regular_hours,
    approvedOvertimeHours: r.approved_overtime_hours,
    basePay: r.base_pay,
    overtimePay: r.overtime_pay,
    allowances: r.allowances,
    deductions: r.deductions,
    advanceDeduction: r.advance_deduction,
    grossPay: r.gross_pay,
    netPayable: r.net_payable,
    paidAmount: r.paid_amount,
    remainingPayable: r.remaining_payable,
    status: r.status,
    notes: r.notes,
    version: r.version,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
  };
}

export async function listWorkerAdvances(
  client: DbClient,
  workerId?: number
): Promise<WorkerAdvanceDto[]> {
  const params: unknown[] = [];
  const whereSql =
    workerId !== undefined
      ? (() => {
          params.push(workerId);
          return "WHERE wa.worker_id = $1";
        })()
      : "";

  const res = await client.query<{
    id: string | number;
    advance_number: string;
    worker_id: string | number;
    worker_code: string;
    worker_name: string;
    advance_date: string;
    amount: string;
    reason: string;
    created_at: Date;
  }>(
    `SELECT
       wa.id, wa.advance_number, wa.worker_id, w.worker_code, w.full_name AS worker_name,
       wa.advance_date::text AS advance_date, wa.amount::text AS amount,
       wa.reason, wa.created_at
     FROM public.worker_advances wa
     JOIN public.workers w ON w.id = wa.worker_id
     ${whereSql}
     ORDER BY wa.advance_date DESC, wa.id DESC
     LIMIT 200`,
    params
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    advanceNumber: r.advance_number,
    workerId: Number(r.worker_id),
    workerCode: r.worker_code,
    workerName: r.worker_name,
    advanceDate: dateStr(r.advance_date),
    amount: r.amount,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function listSalaryPayments(
  client: DbClient,
  filters: { periodId?: number; workerId?: number; dateFrom?: string; dateTo?: string } = {}
): Promise<SalaryPaymentDto[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.periodId !== undefined) {
    params.push(filters.periodId);
    conditions.push(`pe.payroll_period_id = $${params.length}`);
  }
  if (filters.workerId !== undefined) {
    params.push(filters.workerId);
    conditions.push(`sp.worker_id = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`sp.payment_date >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`sp.payment_date <= $${params.length}::date`);
  }

  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const res = await client.query<{
    id: string | number;
    salary_receipt_number: string;
    payroll_entry_id: string | number;
    worker_id: string | number;
    worker_name: string;
    payment_date: string;
    amount: string;
    payment_method: "CASH" | "BANK_TRANSFER";
    reference_note: string | null;
    created_at: Date;
  }>(
    `SELECT
       sp.id, sp.salary_receipt_number, sp.payroll_entry_id, sp.worker_id,
       w.full_name AS worker_name, sp.payment_date::text AS payment_date,
       sp.amount::text AS amount, sp.payment_method, sp.reference_note, sp.created_at
     FROM public.salary_payments sp
     JOIN public.payroll_entries pe ON pe.id = sp.payroll_entry_id
     JOIN public.workers w ON w.id = sp.worker_id
     ${whereSql}
     ORDER BY sp.payment_date DESC, sp.id DESC
     LIMIT 300`,
    params
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    salaryReceiptNumber: r.salary_receipt_number,
    payrollEntryId: Number(r.payroll_entry_id),
    workerId: Number(r.worker_id),
    workerName: r.worker_name,
    paymentDate: dateStr(r.payment_date),
    amount: r.amount,
    paymentMethod: r.payment_method,
    referenceNote: r.reference_note,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function listOperationalExpenses(
  client: DbClient,
  filters: { dateFrom?: string; dateTo?: string } = {}
): Promise<OperationalExpenseDto[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`expense_date >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`expense_date <= $${params.length}::date`);
  }
  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const res = await client.query<{
    id: string | number;
    expense_number: string;
    expense_date: string;
    category: string;
    description: string;
    amount: string;
    created_at: Date;
  }>(
    `SELECT id, expense_number, expense_date::text AS expense_date, category, description,
            amount::text AS amount, created_at
     FROM public.operational_expenses
     ${whereSql}
     ORDER BY expense_date DESC, id DESC
     LIMIT 200`,
    params
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    expenseNumber: r.expense_number,
    expenseDate: dateStr(r.expense_date),
    category: r.category,
    description: r.description,
    amount: r.amount,
    createdAt: r.created_at.toISOString(),
  }));
}

