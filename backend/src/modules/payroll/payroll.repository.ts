import type { Pool, PoolClient } from "pg";
import type {
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
  WorkerAdvanceDto,
  WorkerAdvanceFilters,
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
    updated_by_user_id: string;
    updated_by_username: string | null;
    updated_by_name: string | null;
    updated_by_role: string | null;
    version: number;
    updated_at: Date;
  }>(
    `SELECT
       cp.id, cp.worker_id, w.worker_code, w.full_name AS worker_name, w.designation,
       cp.pay_arrangement, cp.base_rate::text AS base_rate,
       cp.overtime_hourly_rate::text AS overtime_hourly_rate,
       cp.effective_from::text AS effective_from,
       cp.notes,
       cp.updated_by_owner_id AS updated_by_user_id,
       u.username AS updated_by_username,
       u.full_name AS updated_by_name,
       u.role AS updated_by_role,
       cp.version, cp.updated_at
     FROM public.worker_compensation_profiles cp
     JOIN public.workers w ON w.id = cp.worker_id
     LEFT JOIN public.users u ON u.id = cp.updated_by_owner_id
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
    updatedByUserId: r.updated_by_user_id,
    updatedByUsername: r.updated_by_username ?? undefined,
    updatedByName: r.updated_by_name ?? undefined,
    updatedByRole: r.updated_by_role ?? undefined,
    version: r.version,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function findCompensationProfileByWorkerId(
  client: DbClient,
  workerId: number
): Promise<{
  id: number;
  workerId: number;
  payArrangement: PayArrangement;
  baseRate: string | null;
  overtimeHourlyRate: string | null;
  effectiveFrom: string;
  notes: string | null;
  version: number;
  updatedByUserId: string;
} | null> {
  const res = await client.query<{
    id: string | number;
    worker_id: string | number;
    pay_arrangement: PayArrangement;
    base_rate: string | null;
    overtime_hourly_rate: string | null;
    effective_from: string;
    notes: string | null;
    version: number;
    updated_by_owner_id: string;
  }>(
    `SELECT
       id, worker_id, pay_arrangement, base_rate::text AS base_rate,
       overtime_hourly_rate::text AS overtime_hourly_rate,
       effective_from::text AS effective_from, notes, version, updated_by_owner_id
     FROM public.worker_compensation_profiles
     WHERE worker_id = $1
     FOR UPDATE`,
    [workerId]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: Number(r.id),
    workerId: Number(r.worker_id),
    payArrangement: r.pay_arrangement,
    baseRate: r.base_rate,
    overtimeHourlyRate: r.overtime_hourly_rate,
    effectiveFrom: dateStr(r.effective_from),
    notes: r.notes,
    version: r.version,
    updatedByUserId: r.updated_by_owner_id,
  };
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

export async function listCompensationHistory(
  client: DbClient,
  filters: CompensationHistoryFilters = {}
): Promise<CompensationHistoryDto[]> {
  const params: unknown[] = [];
  const whereClauses: string[] = [
    `al.action = 'UPSERT_COMPENSATION'`,
    `al.entity_type = 'WORKER_COMPENSATION'`,
  ];

  if (filters.workerId !== undefined) {
    params.push(String(filters.workerId));
    whereClauses.push(`al.entity_id = $${params.length}`);
  }

  if (filters.userId !== undefined && filters.userId.trim() !== "") {
    const searchVal = filters.userId.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        searchVal
      );
    if (isUuid) {
      params.push(searchVal);
      whereClauses.push(`al.user_id = $${params.length}`);
    } else {
      params.push(`%${searchVal}%`);
      whereClauses.push(
        `(u.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`
      );
    }
  }

  if (filters.dateFrom !== undefined && filters.dateFrom.trim() !== "") {
    params.push(filters.dateFrom.trim());
    whereClauses.push(`al.created_at >= ($${params.length}::date AT TIME ZONE 'Asia/Colombo')`);
  }

  if (filters.dateTo !== undefined && filters.dateTo.trim() !== "") {
    params.push(filters.dateTo.trim());
    whereClauses.push(`al.created_at < (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Colombo')`);
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
  params.push(limit);
  let offsetClause = "";
  if (filters.offset !== undefined && filters.offset >= 0) {
    params.push(filters.offset);
    offsetClause = ` OFFSET $${params.length}`;
  }

  const res = await client.query<{
    id: string | number;
    user_id: string;
    username: string | null;
    full_name: string | null;
    role: string | null;
    details: Record<string, any>;
    created_at: Date;
  }>(
    `SELECT
       al.id, al.user_id, u.username, u.full_name, u.role,
       al.details, al.created_at
     FROM public.audit_logs al
     LEFT JOIN public.users u ON u.id = al.user_id
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT $${params.length - (offsetClause ? 1 : 0)}${offsetClause}`,
    params
  );

  return res.rows.map((r) => {
    const d = r.details || {};
    return {
      id: Number(r.id),
      workerId: Number(d.workerId ?? 0),
      workerCode: String(d.workerCode ?? ""),
      workerName: String(d.fullName ?? d.workerName ?? ""),
      oldPayArrangement: d.oldPayArrangement ?? null,
      newPayArrangement: (d.newPayArrangement ?? d.payArrangement ?? "MANUAL") as PayArrangement,
      oldBaseRate: d.oldBaseRate !== undefined ? d.oldBaseRate : null,
      newBaseRate: d.newBaseRate !== undefined ? d.newBaseRate : (d.baseRate ?? null),
      oldOvertimeHourlyRate: d.oldOvertimeHourlyRate !== undefined ? d.oldOvertimeHourlyRate : null,
      newOvertimeHourlyRate: d.newOvertimeHourlyRate !== undefined ? d.newOvertimeHourlyRate : (d.overtimeHourlyRate ?? null),
      changedByUserId: r.user_id,
      changedByUsername: r.username ?? d.actorUsername ?? "System",
      changedByName: r.full_name ?? d.actorName ?? "System",
      changedByRole: r.role ?? d.actorRole ?? "OWNER",
      reason: String(d.reason ?? "Salary rate update"),
      effectiveFrom: String(d.effectiveFrom ?? ""),
      createdAt: r.created_at.toISOString(),
    };
  });
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
    created_by_user_id: string | null;
    created_by_username: string | null;
    created_by_name: string | null;
    created_by_role: string | null;
    approved_by_user_id: string | null;
    approved_by_username: string | null;
    approved_by_name: string | null;
    approved_by_role: string | null;
    approved_at: Date | null;
    created_at: Date;
  }>(
    `SELECT
       pp.id, pp.period_label, pp.start_date::text AS start_date, pp.end_date::text AS end_date,
       pp.status, pp.notes, pp.version,
       pp.created_by_owner_id AS created_by_user_id,
       cu.username AS created_by_username,
       cu.full_name AS created_by_name,
       cu.role AS created_by_role,
       pp.approved_by_owner_id AS approved_by_user_id,
       au.username AS approved_by_username,
       au.full_name AS approved_by_name,
       au.role AS approved_by_role,
       pp.approved_at,
       pp.created_at
     FROM public.payroll_periods pp
     LEFT JOIN public.users cu ON cu.id = pp.created_by_owner_id
     LEFT JOIN public.users au ON au.id = pp.approved_by_owner_id
     ORDER BY pp.start_date DESC, pp.id DESC
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
    createdByUserId: r.created_by_user_id ?? undefined,
    createdByUsername: r.created_by_username ?? undefined,
    createdByName: r.created_by_name ?? undefined,
    createdByRole: r.created_by_role ?? undefined,
    approvedByUserId: r.approved_by_user_id ?? undefined,
    approvedByUsername: r.approved_by_username ?? undefined,
    approvedByName: r.approved_by_name ?? undefined,
    approvedByRole: r.approved_by_role ?? undefined,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function findPayrollPeriodById(
  client: DbClient,
  periodId: number,
  forUpdate = false
): Promise<PayrollPeriodDto | null> {
  const lockClause = forUpdate ? " FOR UPDATE OF pp" : "";
  const res = await client.query<{
    id: string | number;
    period_label: string;
    start_date: string;
    end_date: string;
    status: "DRAFT" | "APPROVED" | "CLOSED";
    notes: string | null;
    version: number;
    created_by_user_id: string | null;
    created_by_username: string | null;
    created_by_name: string | null;
    created_by_role: string | null;
    approved_by_user_id: string | null;
    approved_by_username: string | null;
    approved_by_name: string | null;
    approved_by_role: string | null;
    approved_at: Date | null;
    created_at: Date;
  }>(
    `SELECT
       pp.id, pp.period_label, pp.start_date::text AS start_date, pp.end_date::text AS end_date,
       pp.status, pp.notes, pp.version,
       pp.created_by_owner_id AS created_by_user_id,
       cu.username AS created_by_username,
       cu.full_name AS created_by_name,
       cu.role AS created_by_role,
       pp.approved_by_owner_id AS approved_by_user_id,
       au.username AS approved_by_username,
       au.full_name AS approved_by_name,
       au.role AS approved_by_role,
       pp.approved_at,
       pp.created_at
     FROM public.payroll_periods pp
     LEFT JOIN public.users cu ON cu.id = pp.created_by_owner_id
     LEFT JOIN public.users au ON au.id = pp.approved_by_owner_id
     WHERE pp.id = $1${lockClause}`,
    [periodId]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: Number(r.id),
    periodLabel: r.period_label,
    startDate: dateStr(r.start_date),
    endDate: dateStr(r.end_date),
    status: r.status,
    notes: r.notes,
    version: r.version,
    createdByUserId: r.created_by_user_id ?? undefined,
    createdByUsername: r.created_by_username ?? undefined,
    createdByName: r.created_by_name ?? undefined,
    createdByRole: r.created_by_role ?? undefined,
    approvedByUserId: r.approved_by_user_id ?? undefined,
    approvedByUsername: r.approved_by_username ?? undefined,
    approvedByName: r.approved_by_name ?? undefined,
    approvedByRole: r.approved_by_role ?? undefined,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
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
    ownerUserId?: string;
    createdByUserId?: string;
  }
): Promise<number> {
  const creatorId = params.createdByUserId ?? params.ownerUserId;
  const res = await client.query<{ id: string | number }>(
    `INSERT INTO public.payroll_periods (
       period_label, start_date, end_date, notes, created_by_owner_id
     ) VALUES ($1, $2::date, $3::date, $4, $5)
     RETURNING id`,
    [
      params.periodLabel,
      params.startDate,
      params.endDate,
      params.notes,
      creatorId,
    ]
  );
  return Number(res.rows[0].id);
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
    `SELECT
       pe.id, pe.payroll_period_id, pe.worker_id, w.worker_code, w.full_name AS worker_name,
       w.designation, pe.pay_arrangement_snapshot, pe.calculation_mode,
       pe.approved_days_count, pe.approved_regular_hours::text AS approved_regular_hours,
       pe.approved_overtime_hours::text AS approved_overtime_hours,
       pe.base_pay::text AS base_pay, pe.overtime_pay::text AS overtime_pay,
       pe.allowances::text AS allowances, pe.deductions::text AS deductions,
       pe.advance_deduction::text AS advance_deduction, pe.gross_pay::text AS gross_pay,
       pe.net_payable::text AS net_payable,
       COALESCE(
         (
           SELECT SUM(
             COALESCE(
               (
                 SELECT spa.corrected_amount
                 FROM public.salary_payment_adjustments spa
                 WHERE spa.salary_payment_id = sp.id
                 ORDER BY spa.id DESC
                 LIMIT 1
               ),
               sp.amount
             )
           )
           FROM public.salary_payments sp
           WHERE sp.payroll_entry_id = pe.id
         ),
         0
       )::text AS paid_amount,
       (
         pe.net_payable - COALESCE(
           (
             SELECT SUM(
               COALESCE(
                 (
                   SELECT spa.corrected_amount
                   FROM public.salary_payment_adjustments spa
                   WHERE spa.salary_payment_id = sp.id
                   ORDER BY spa.id DESC
                   LIMIT 1
                 ),
                 sp.amount
               )
             )
             FROM public.salary_payments sp
             WHERE sp.payroll_entry_id = pe.id
           ),
           0
         )
       )::text AS remaining_payable,
       pe.status, pe.notes,
       pe.version, pe.approved_at
     FROM public.payroll_entries pe
     JOIN public.workers w ON w.id = pe.worker_id
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
  const lockClause = forUpdate ? " FOR UPDATE OF pe" : "";
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
       pe.id, pe.payroll_period_id, pe.worker_id, w.worker_code, w.full_name AS worker_name,
       w.designation, pe.pay_arrangement_snapshot, pe.calculation_mode,
       pe.approved_days_count, pe.approved_regular_hours::text AS approved_regular_hours,
       pe.approved_overtime_hours::text AS approved_overtime_hours,
       pe.base_pay::text AS base_pay, pe.overtime_pay::text AS overtime_pay,
       pe.allowances::text AS allowances, pe.deductions::text AS deductions,
       pe.advance_deduction::text AS advance_deduction, pe.gross_pay::text AS gross_pay,
       pe.net_payable::text AS net_payable,
       COALESCE(
         (
           SELECT SUM(
             COALESCE(
               (
                 SELECT spa.corrected_amount
                 FROM public.salary_payment_adjustments spa
                 WHERE spa.salary_payment_id = sp.id
                 ORDER BY spa.id DESC
                 LIMIT 1
               ),
               sp.amount
             )
           )
           FROM public.salary_payments sp
           WHERE sp.payroll_entry_id = pe.id
         ),
         0
       )::text AS paid_amount,
       (
         pe.net_payable - COALESCE(
           (
             SELECT SUM(
               COALESCE(
                 (
                   SELECT spa.corrected_amount
                   FROM public.salary_payment_adjustments spa
                   WHERE spa.salary_payment_id = sp.id
                   ORDER BY spa.id DESC
                   LIMIT 1
                 ),
                 sp.amount
               )
             )
             FROM public.salary_payments sp
             WHERE sp.payroll_entry_id = pe.id
           ),
           0
         )
       )::text AS remaining_payable,
       pe.status, pe.notes,
       pe.version, pe.approved_at
     FROM public.payroll_entries pe
     JOIN public.workers w ON w.id = pe.worker_id
     WHERE pe.id = $1${lockClause}`,
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
  filters?: WorkerAdvanceFilters | number
): Promise<WorkerAdvanceDto[]> {
  const normFilters: WorkerAdvanceFilters =
    typeof filters === "number" ? { workerId: filters } : (filters ?? {});

  const params: unknown[] = [];
  const whereClauses: string[] = [];

  if (normFilters.workerId !== undefined) {
    params.push(normFilters.workerId);
    whereClauses.push(`wa.worker_id = $${params.length}`);
  }

  if (normFilters.userId !== undefined && normFilters.userId.trim() !== "") {
    const searchVal = normFilters.userId.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        searchVal
      );
    if (isUuid) {
      params.push(searchVal);
      whereClauses.push(`wa.authorized_by_owner_id = $${params.length}`);
    } else {
      params.push(`%${searchVal}%`);
      whereClauses.push(
        `(u.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`
      );
    }
  }

  if (normFilters.dateFrom !== undefined && normFilters.dateFrom.trim() !== "") {
    params.push(normFilters.dateFrom.trim());
    whereClauses.push(`wa.advance_date >= $${params.length}::date`);
  }

  if (normFilters.dateTo !== undefined && normFilters.dateTo.trim() !== "") {
    params.push(normFilters.dateTo.trim());
    whereClauses.push(`wa.advance_date <= $${params.length}::date`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(normFilters.limit ?? 200, 1), 300);
  params.push(limit);
  let offsetClause = "";
  if (normFilters.offset !== undefined && normFilters.offset >= 0) {
    params.push(normFilters.offset);
    offsetClause = ` OFFSET $${params.length}`;
  }

  const res = await client.query<{
    id: string | number;
    advance_number: string;
    worker_id: string | number;
    worker_code: string;
    worker_name: string;
    advance_date: string;
    amount: string;
    reason: string;
    authorized_by_user_id: string;
    authorized_by_username: string | null;
    authorized_by_name: string | null;
    authorized_by_role: string | null;
    created_at: Date;
  }>(
    `SELECT
       wa.id, wa.advance_number, wa.worker_id, w.worker_code, w.full_name AS worker_name,
       wa.advance_date::text AS advance_date, wa.amount::text AS amount,
       wa.reason, wa.authorized_by_owner_id AS authorized_by_user_id,
       u.username AS authorized_by_username, u.full_name AS authorized_by_name, u.role AS authorized_by_role,
       wa.created_at
     FROM public.worker_advances wa
     JOIN public.workers w ON w.id = wa.worker_id
     LEFT JOIN public.users u ON u.id = wa.authorized_by_owner_id
     ${whereSql}
     ORDER BY wa.advance_date DESC, wa.id DESC
     LIMIT $${params.length - (offsetClause ? 1 : 0)}${offsetClause}`,
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
    authorizedByUserId: r.authorized_by_user_id,
    authorizedByUsername: r.authorized_by_username ?? undefined,
    authorizedByName: r.authorized_by_name ?? undefined,
    authorizedByRole: r.authorized_by_role ?? undefined,
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
    effective_amount: string;
    payment_method: "CASH" | "BANK_TRANSFER";
    reference_note: string | null;
    paid_by_owner_id: string;
    paid_by_owner_username: string | null;
    paid_by_owner_name: string | null;
    paid_by_owner_role: string | null;
    created_at: Date;
  }>(
    `SELECT
       sp.id, sp.salary_receipt_number, sp.payroll_entry_id, sp.worker_id,
       w.full_name AS worker_name, sp.payment_date::text AS payment_date,
       sp.amount::text AS amount,
       COALESCE(
         (
           SELECT spa.corrected_amount
           FROM public.salary_payment_adjustments spa
           WHERE spa.salary_payment_id = sp.id
           ORDER BY spa.id DESC
           LIMIT 1
         ),
         sp.amount
       )::text AS effective_amount,
       sp.payment_method, sp.reference_note,
       sp.paid_by_owner_id, u.username AS paid_by_owner_username,
       u.full_name AS paid_by_owner_name, u.role AS paid_by_owner_role,
       sp.created_at
     FROM public.salary_payments sp
     JOIN public.payroll_entries pe ON pe.id = sp.payroll_entry_id
     JOIN public.workers w ON w.id = sp.worker_id
     LEFT JOIN public.users u ON u.id = sp.paid_by_owner_id
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
    effectiveAmount: r.effective_amount,
    paymentMethod: r.payment_method,
    referenceNote: r.reference_note,
    paidByOwnerId: r.paid_by_owner_id,
    paidByOwnerUsername: r.paid_by_owner_username ?? undefined,
    paidByOwnerName: r.paid_by_owner_name ?? undefined,
    paidByOwnerRole: r.paid_by_owner_role ?? undefined,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function findSalaryPaymentById(
  client: DbClient,
  paymentId: number,
  forUpdate = false
): Promise<SalaryPaymentDto | null> {
  const lockClause = forUpdate ? " FOR UPDATE OF sp" : "";
  const res = await client.query<{
    id: string | number;
    salary_receipt_number: string;
    payroll_entry_id: string | number;
    worker_id: string | number;
    worker_name: string;
    payment_date: string;
    amount: string;
    effective_amount: string;
    payment_method: "CASH" | "BANK_TRANSFER";
    reference_note: string | null;
    paid_by_owner_id: string;
    paid_by_owner_username: string | null;
    paid_by_owner_name: string | null;
    paid_by_owner_role: string | null;
    created_at: Date;
  }>(
    `SELECT
       sp.id, sp.salary_receipt_number, sp.payroll_entry_id, sp.worker_id,
       w.full_name AS worker_name, sp.payment_date::text AS payment_date,
       sp.amount::text AS amount,
       COALESCE(
         (
           SELECT spa.corrected_amount
           FROM public.salary_payment_adjustments spa
           WHERE spa.salary_payment_id = sp.id
           ORDER BY spa.id DESC
           LIMIT 1
         ),
         sp.amount
       )::text AS effective_amount,
       sp.payment_method, sp.reference_note,
       sp.paid_by_owner_id, u.username AS paid_by_owner_username,
       u.full_name AS paid_by_owner_name, u.role AS paid_by_owner_role,
       sp.created_at
     FROM public.salary_payments sp
     JOIN public.payroll_entries pe ON pe.id = sp.payroll_entry_id
     JOIN public.workers w ON w.id = sp.worker_id
     LEFT JOIN public.users u ON u.id = sp.paid_by_owner_id
     WHERE sp.id = $1${lockClause}`,
    [paymentId]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: Number(r.id),
    salaryReceiptNumber: r.salary_receipt_number,
    payrollEntryId: Number(r.payroll_entry_id),
    workerId: Number(r.worker_id),
    workerName: r.worker_name,
    paymentDate: r.payment_date ? dateStr(r.payment_date) : new Date().toISOString().slice(0, 10),
    amount: r.amount,
    effectiveAmount: r.effective_amount ?? r.amount,
    paymentMethod: r.payment_method ?? "CASH",
    referenceNote: r.reference_note ?? null,
    paidByOwnerId: r.paid_by_owner_id,
    paidByOwnerUsername: r.paid_by_owner_username ?? undefined,
    paidByOwnerName: r.paid_by_owner_name ?? undefined,
    paidByOwnerRole: r.paid_by_owner_role ?? undefined,
    createdAt: r.created_at
      ? r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at)
      : new Date().toISOString(),
  };
}

export async function findLatestSalaryPaymentAdjustment(
  client: DbClient,
  salaryPaymentId: number
): Promise<{
  id: number;
  adjustmentNumber: string;
  adjustmentType: SalaryAdjustmentType;
  correctedAmount: string;
  priorEffectiveAmount: string;
  createdAt: string;
} | null> {
  const res = await client.query<{
    id: string | number;
    adjustment_number: string;
    adjustment_type: SalaryAdjustmentType;
    corrected_amount: string;
    prior_effective_amount: string;
    created_at: Date;
  }>(
    `SELECT id, adjustment_number, adjustment_type,
            corrected_amount::text AS corrected_amount,
            prior_effective_amount::text AS prior_effective_amount,
            created_at
     FROM public.salary_payment_adjustments
     WHERE salary_payment_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [salaryPaymentId]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: Number(r.id),
    adjustmentNumber: r.adjustment_number,
    adjustmentType: r.adjustment_type,
    correctedAmount: r.corrected_amount,
    priorEffectiveAmount: r.prior_effective_amount,
    createdAt: r.created_at
      ? r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at)
      : new Date().toISOString(),
  };
}

export async function insertSalaryPaymentAdjustment(
  client: PoolClient,
  params: {
    salaryPaymentId: number;
    payrollEntryId: number;
    workerId: number;
    adjustmentType: SalaryAdjustmentType;
    priorEffectiveAmount: string;
    correctedAmount: string;
    adjustmentDelta: string;
    authorizedByOwnerId: string;
    reason: string;
    idempotencyKey: string;
  }
): Promise<{ id: number; adjustmentNumber: string; createdAt: string }> {
  const res = await client.query<{
    id: string | number;
    adjustment_number: string;
    created_at: Date;
  }>(
    `INSERT INTO public.salary_payment_adjustments (
       salary_payment_id,
       payroll_entry_id,
       worker_id,
       adjustment_type,
       prior_effective_amount,
       corrected_amount,
       adjustment_delta,
       authorized_by_owner_id,
       reason,
       idempotency_key
     ) VALUES (
       $1, $2, $3, $4,
       $5::numeric(12, 2),
       $6::numeric(12, 2),
       $7::numeric(12, 2),
       $8, $9, $10
     )
     RETURNING id, adjustment_number, created_at`,
    [
      params.salaryPaymentId,
      params.payrollEntryId,
      params.workerId,
      params.adjustmentType,
      params.priorEffectiveAmount,
      params.correctedAmount,
      params.adjustmentDelta,
      params.authorizedByOwnerId,
      params.reason,
      params.idempotencyKey,
    ]
  );
  const r = res.rows[0];
  return {
    id: Number(r.id),
    adjustmentNumber: r.adjustment_number,
    createdAt: r.created_at.toISOString(),
  };
}

export async function listSalaryPaymentAdjustments(
  client: DbClient,
  salaryPaymentId: number
): Promise<SalaryPaymentAdjustmentDto[]> {
  const res = await client.query<{
    id: string | number;
    adjustment_number: string;
    salary_payment_id: string | number;
    payroll_entry_id: string | number;
    worker_id: string | number;
    worker_name: string;
    adjustment_type: SalaryAdjustmentType;
    prior_effective_amount: string;
    corrected_amount: string;
    adjustment_delta: string;
    authorized_by_owner_id: string;
    authorized_by_username: string | null;
    authorized_by_name: string | null;
    authorized_by_role: string | null;
    reason: string;
    created_at: Date;
  }>(
    `SELECT
       spa.id, spa.adjustment_number, spa.salary_payment_id, spa.payroll_entry_id,
       spa.worker_id, w.full_name AS worker_name, spa.adjustment_type,
       spa.prior_effective_amount::text AS prior_effective_amount,
       spa.corrected_amount::text AS corrected_amount,
       spa.adjustment_delta::text AS adjustment_delta,
       spa.authorized_by_owner_id,
       u.username AS authorized_by_username,
       u.full_name AS authorized_by_name,
       u.role AS authorized_by_role,
       spa.reason,
       spa.created_at
     FROM public.salary_payment_adjustments spa
     JOIN public.workers w ON w.id = spa.worker_id
     LEFT JOIN public.users u ON u.id = spa.authorized_by_owner_id
     WHERE spa.salary_payment_id = $1
     ORDER BY spa.id ASC`,
    [salaryPaymentId]
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    adjustmentNumber: r.adjustment_number,
    salaryPaymentId: Number(r.salary_payment_id),
    payrollEntryId: Number(r.payroll_entry_id),
    workerId: Number(r.worker_id),
    workerName: r.worker_name,
    adjustmentType: r.adjustment_type,
    priorEffectiveAmount: r.prior_effective_amount,
    correctedAmount: r.corrected_amount,
    adjustmentDelta: r.adjustment_delta,
    authorizedByUserId: r.authorized_by_owner_id,
    authorizedByUsername: r.authorized_by_username ?? undefined,
    authorizedByName: r.authorized_by_name ?? undefined,
    authorizedByRole: r.authorized_by_role ?? undefined,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function listOperationalExpenses(
  client: DbClient,
  filters: OperationalExpenseFilters = {}
): Promise<OperationalExpenseDto[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.category !== undefined && filters.category.trim() !== "") {
    params.push(filters.category.trim());
    conditions.push(`oe.category = $${params.length}`);
  }

  if (filters.userId !== undefined && filters.userId.trim() !== "") {
    const searchVal = filters.userId.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        searchVal
      );
    if (isUuid) {
      params.push(searchVal);
      conditions.push(`oe.recorded_by_owner_id = $${params.length}`);
    } else {
      params.push(`%${searchVal}%`);
      conditions.push(
        `(u.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`
      );
    }
  }

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`oe.expense_date >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`oe.expense_date <= $${params.length}::date`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 300);
  params.push(limit);
  let offsetClause = "";
  if (filters.offset !== undefined && filters.offset >= 0) {
    params.push(filters.offset);
    offsetClause = ` OFFSET $${params.length}`;
  }

  const res = await client.query<{
    id: string | number;
    expense_number: string;
    expense_date: string;
    category: string;
    description: string;
    amount: string;
    recorded_by_user_id: string;
    recorded_by_username: string | null;
    recorded_by_name: string | null;
    recorded_by_role: string | null;
    created_at: Date;
  }>(
    `SELECT oe.id, oe.expense_number, oe.expense_date::text AS expense_date, oe.category, oe.description,
            oe.amount::text AS amount, oe.recorded_by_owner_id AS recorded_by_user_id,
            u.username AS recorded_by_username, u.full_name AS recorded_by_name, u.role AS recorded_by_role,
            oe.created_at
     FROM public.operational_expenses oe
     LEFT JOIN public.users u ON u.id = oe.recorded_by_owner_id
     ${whereSql}
     ORDER BY oe.expense_date DESC, oe.id DESC
     LIMIT $${params.length - (offsetClause ? 1 : 0)}${offsetClause}`,
    params
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    expenseNumber: r.expense_number,
    expenseDate: dateStr(r.expense_date),
    category: r.category,
    description: r.description,
    amount: r.amount,
    recordedByUserId: r.recorded_by_user_id,
    recordedByUsername: r.recorded_by_username ?? undefined,
    recordedByName: r.recorded_by_name ?? undefined,
    recordedByRole: r.recorded_by_role ?? undefined,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function findOverlappingPayrollPeriod(
  client: DbClient,
  startDate: string,
  endDate: string,
  excludePeriodId?: number
): Promise<{ id: number; periodLabel: string; startDate: string; endDate: string } | null> {
  const params: unknown[] = [startDate, endDate];
  let excludeClause = "";
  if (excludePeriodId !== undefined) {
    params.push(excludePeriodId);
    excludeClause = ` AND id != $${params.length}`;
  }

  const res = await client.query<{
    id: string | number;
    period_label: string;
    start_date: string;
    end_date: string;
  }>(
    `SELECT id, period_label, start_date::text AS start_date, end_date::text AS end_date
     FROM public.payroll_periods
     WHERE status != 'CANCELLED'
       AND start_date <= $2::date
       AND end_date >= $1::date${excludeClause}
     ORDER BY start_date ASC
     LIMIT 1`,
    params
  );

  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: Number(r.id),
    periodLabel: r.period_label,
    startDate: dateStr(r.start_date),
    endDate: dateStr(r.end_date),
  };
}

export async function calculateAdvancesForWorkerInPeriod(
  client: DbClient,
  workerId: number,
  startDate: string,
  endDate: string
): Promise<string> {
  const res = await client.query<{ total_advances: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total_advances
     FROM public.worker_advances
     WHERE worker_id = $1
       AND advance_date >= $2::date
       AND advance_date <= $3::date`,
    [workerId, startDate, endDate]
  );
  return res.rows[0]?.total_advances ?? "0.00";
}

export async function initializePeriodManualEntries(
  client: PoolClient,
  periodId: number,
  startDate: string,
  endDate: string
): Promise<number> {
  const res = await client.query(
    `INSERT INTO public.payroll_entries (
       payroll_period_id,
       worker_id,
       pay_arrangement_snapshot,
       calculation_mode,
       approved_days_count,
       approved_regular_hours,
       approved_overtime_hours,
       base_pay,
       overtime_pay,
       allowances,
       deductions,
       advance_deduction,
       gross_pay,
       net_payable,
       status,
       notes,
       version
     )
     SELECT
       $1::bigint,
       w.id,
       'MONTHLY',
       'OWNER_MANUAL_DRAFT',
       0,
       0.00,
       0.00,
       0.00,
       0.00,
       0.00,
       0.00,
       COALESCE(
         (
           SELECT SUM(wa.amount)
           FROM public.worker_advances wa
           WHERE wa.worker_id = w.id
             AND wa.advance_date >= $2::date
             AND wa.advance_date <= $3::date
         ),
         0.00
       ),
       0.00,
       0.00,
       'DRAFT',
       'Manual salary entry initialized',
       1
     FROM public.workers w
     WHERE w.employment_status = 'ACTIVE'
     ON CONFLICT (payroll_period_id, worker_id) DO NOTHING`,
    [periodId, startDate, endDate]
  );
  return res.rowCount ?? 0;
}

export async function updateManualSalaryEntry(
  client: PoolClient,
  params: {
    entryId: number;
    expectedVersion: number;
    grossSalary: string;
    advanceDeduction: string;
    netPayable: string;
    notes: string | null;
  }
): Promise<boolean> {
  const res = await client.query(
    `UPDATE public.payroll_entries
     SET base_pay = $1::numeric(12, 2),
         gross_pay = $1::numeric(12, 2),
         overtime_pay = 0.00,
         allowances = 0.00,
         deductions = 0.00,
         advance_deduction = $2::numeric(12, 2),
         net_payable = $3::numeric(12, 2),
         notes = $4,
         calculation_mode = 'OWNER_MANUAL_DRAFT',
         pay_arrangement_snapshot = 'MONTHLY',
         version = version + 1,
         updated_at = NOW()
     WHERE id = $5
       AND version = $6
       AND status = 'DRAFT'`,
    [
      params.grossSalary,
      params.advanceDeduction,
      params.netPayable,
      params.notes,
      params.entryId,
      params.expectedVersion,
    ]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function updateApprovedSalaryEntry(
  client: PoolClient,
  params: {
    entryId: number;
    expectedVersion: number;
    grossSalary: string;
    advanceDeduction: string;
    netPayable: string;
    notes: string | null;
  }
): Promise<boolean> {
  const res = await client.query(
    `UPDATE public.payroll_entries
     SET base_pay = $1::numeric(12, 2),
         gross_pay = $1::numeric(12, 2),
         overtime_pay = 0.00,
         allowances = 0.00,
         deductions = 0.00,
         advance_deduction = $2::numeric(12, 2),
         net_payable = $3::numeric(12, 2),
         notes = $4,
         calculation_mode = 'OWNER_MANUAL_DRAFT',
         pay_arrangement_snapshot = 'MONTHLY',
         version = version + 1,
         updated_at = NOW()
     WHERE id = $5
       AND version = $6
       AND status = 'APPROVED'`,
    [
      params.grossSalary,
      params.advanceDeduction,
      params.netPayable,
      params.notes,
      params.entryId,
      params.expectedVersion,
    ]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listSalaryAuditHistory(
  client: DbClient,
  filters: SalaryAuditHistoryFilters = {}
): Promise<SalaryAuditHistoryDto[]> {
  const conditions: string[] = [
    "(al.action = 'UPDATE_MANUAL_SALARY' OR al.action = 'UPDATE_APPROVED_SALARY')",
  ];
  const params: unknown[] = [];

  if (filters.entryId !== undefined) {
    params.push(String(filters.entryId));
    conditions.push(`al.entity_id = $${params.length}`);
  }

  if (filters.workerId !== undefined) {
    params.push(String(filters.workerId));
    conditions.push(`(al.details->>'workerId') = $${params.length}`);
  }

  if (filters.periodId !== undefined) {
    params.push(String(filters.periodId));
    conditions.push(`(al.details->>'periodId') = $${params.length}`);
  }

  const whereSql = `WHERE ${conditions.join(" AND ")}`;
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 300);
  params.push(limit);
  let offsetClause = "";
  if (filters.offset !== undefined && filters.offset >= 0) {
    params.push(filters.offset);
    offsetClause = ` OFFSET $${params.length}`;
  }

  const res = await client.query<{
    id: string | number;
    user_id: string;
    username: string | null;
    full_name: string | null;
    role: string | null;
    action: string;
    details: Record<string, any>;
    created_at: Date;
  }>(
    `SELECT
       al.id, al.user_id, u.username, u.full_name, u.role,
       al.action, al.details, al.created_at
     FROM public.audit_logs al
     LEFT JOIN public.users u ON u.id = al.user_id
     ${whereSql}
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT $${params.length - (offsetClause ? 1 : 0)}${offsetClause}`,
    params
  );

  return res.rows.map((r) => {
    const d = r.details || {};
    return {
      id: Number(r.id),
      payrollEntryId: Number(d.payrollEntryId ?? d.entryId ?? 0),
      workerId: Number(d.workerId ?? 0),
      workerCode: d.workerCode ? String(d.workerCode) : undefined,
      workerName: d.workerName ? String(d.workerName) : undefined,
      periodId: Number(d.periodId ?? 0),
      periodLabel: d.periodLabel ? String(d.periodLabel) : undefined,
      action: r.action,
      previousGrossSalary:
        d.previousGrossSalary !== undefined && d.previousGrossSalary !== null
          ? String(d.previousGrossSalary)
          : null,
      newGrossSalary:
        d.newGrossSalary !== undefined && d.newGrossSalary !== null
          ? String(d.newGrossSalary)
          : null,
      applicableAdvances:
        d.applicableAdvances !== undefined && d.applicableAdvances !== null
          ? String(d.applicableAdvances)
          : null,
      calculatedNetPayable:
        d.calculatedNetPayable !== undefined && d.calculatedNetPayable !== null
          ? String(d.calculatedNetPayable)
          : null,
      excessAdvances:
        d.excessAdvances !== undefined && d.excessAdvances !== null
          ? String(d.excessAdvances)
          : null,
      reason: String(d.reason ?? ""),
      notes: d.notes ? String(d.notes) : null,
      actorUserId: r.user_id,
      actorUsername: r.username ?? d.actorUsername ?? "Unknown",
      actorRole: r.role ?? d.actorRole ?? "STAFF",
      createdAt: r.created_at.toISOString(),
    };
  });
}
