import type { Pool } from "pg";

export interface OwnerOverviewReport {
  businessDate: string;
  todayInvoiceCount: number;
  todayBilledTotal: string;
  todayCashCollected: string;
  todayReceiptCount: number;
  totalOutstandingBalance: string;
  openInvoicesCount: number;
  totalIssuedInvoicesCount: number;
}

export interface FinancialReportSummary {
  dateFrom: string;
  dateTo: string;
  billedSalesTotal: string;
  issuedInvoiceCount: number;
  cashCollectedTotal: string;
  receiptCount: number;
  outstandingReceivablesTotal: string;
  openInvoicesCount: number;
  recordedExpensesTotal: string;
  payrollApprovedLiabilityTotal: string;
  payrollCashPaidTotal: string;
  dailySales: Array<{
    businessDate: string;
    invoiceCount: number;
    billedTotal: string;
    cashCollectedTotal: string;
  }>;
  cashierCollections: Array<{
    userId: string;
    fullName: string;
    receiptCount: number;
    physicalCashMovement: string;
  }>;
  expensesBreakdown: Array<{
    category: string;
    totalAmount: string;
    entryCount: number;
  }>;
}

export interface OperationsReportSummary {
  dateFrom: string;
  dateTo: string;
  approvedAttendanceDays: number;
  approvedWorkerHours: string;
  approvedOvertimeHours: string;
  approvedMachineHours: string;
  approvedMachineDowntimeMinutes: number;
  approvedProductionTotalM3: string;
  pendingApprovalCounts: {
    attendance: number;
    machineLogs: number;
    productionLogs: number;
  };
  productionByMaterial: Array<{
    materialId: number;
    materialName: string;
    totalQuantityM3: string;
    entryCount: number;
  }>;
  productionByMachine: Array<{
    machineId: number | null;
    machineName: string;
    totalQuantityM3: string;
    entryCount: number;
  }>;
  machineSummary: Array<{
    machineId: number;
    machineName: string;
    netOperatingHours: string;
    downtimeMinutes: number;
    scheduledHours: string | null;
    utilizationPercent: string | null;
  }>;
}

interface OverviewRow {
  business_date: string;
  today_invoice_count: number;
  today_billed_total: string;
  today_cash_collected: string;
  today_receipt_count: number;
  total_outstanding_balance: string;
  open_invoices_count: number;
  total_issued_invoices_count: number;
}

export async function fetchOwnerOverviewReport(
  pool: Pool
): Promise<OwnerOverviewReport> {
  const res = await pool.query<OverviewRow>(
    `WITH colombo_today AS (
       SELECT DATE(NOW() AT TIME ZONE 'Asia/Colombo') AS today_date
     ),
     ledger_stats AS (
       SELECT
         COUNT(*) FILTER (
           WHERE ilv.invoice_status = 'ISSUED' AND ilv.business_date = ct.today_date
         )::int AS today_invoice_count,
         COALESCE(
           SUM(ilv.effective_grand_total) FILTER (
             WHERE ilv.invoice_status = 'ISSUED' AND ilv.business_date = ct.today_date
           ),
           0.00
         )::NUMERIC(12, 2)::text AS today_billed_total,
         COALESCE(
           SUM(ilv.balance_due) FILTER (
             WHERE ilv.invoice_status = 'ISSUED' AND ilv.balance_due > 0.00
           ),
           0.00
         )::NUMERIC(12, 2)::text AS total_outstanding_balance,
         COUNT(*) FILTER (
           WHERE ilv.invoice_status = 'ISSUED' AND ilv.balance_due > 0.00
         )::int AS open_invoices_count,
         COUNT(*) FILTER (
           WHERE ilv.invoice_status = 'ISSUED'
         )::int AS total_issued_invoices_count
       FROM public.invoice_ledger_view ilv
       CROSS JOIN colombo_today ct
     ),
     cash_stats AS (
       SELECT
         COALESCE(SUM(dcr.net_effective_cash), 0.00)::NUMERIC(12, 2)::text AS today_cash_collected,
         COALESCE(SUM(dcr.receipt_count), 0)::int AS today_receipt_count
       FROM public.daily_cash_reconciliation_view dcr
       JOIN colombo_today ct ON dcr.business_date = ct.today_date
     )
     SELECT
       ct.today_date::text AS business_date,
       ls.today_invoice_count,
       ls.today_billed_total,
       cs.today_cash_collected,
       cs.today_receipt_count,
       ls.total_outstanding_balance,
       ls.open_invoices_count,
       ls.total_issued_invoices_count
     FROM colombo_today ct
     CROSS JOIN ledger_stats ls
     CROSS JOIN cash_stats cs`
  );

  const row = res.rows[0];
  return {
    businessDate: row.business_date,
    todayInvoiceCount: row.today_invoice_count,
    todayBilledTotal: row.today_billed_total,
    todayCashCollected: row.today_cash_collected,
    todayReceiptCount: row.today_receipt_count,
    totalOutstandingBalance: row.total_outstanding_balance,
    openInvoicesCount: row.open_invoices_count,
    totalIssuedInvoicesCount: row.total_issued_invoices_count,
  };
}

export async function fetchFinancialReport(
  pool: Pool,
  dateFrom: string,
  dateTo: string
): Promise<FinancialReportSummary> {
  const [
    totalsRes,
    cashTotalsRes,
    outstandingRes,
    expensesTotalRes,
    payrollLiabilityRes,
    payrollPaidRes,
    dailySalesRes,
    cashiersRes,
    expensesBreakdownRes,
  ] = await Promise.all([
    pool.query<{ billed_total: string; inv_count: number }>(
      `SELECT
         COALESCE(SUM(effective_grand_total), 0.00)::NUMERIC(12, 2)::text AS billed_total,
         COUNT(*)::int AS inv_count
       FROM public.invoice_ledger_view
       WHERE invoice_status = 'ISSUED'
         AND business_date BETWEEN $1::date AND $2::date`,
      [dateFrom, dateTo]
    ),
    pool.query<{ cash_total: string; receipt_count: number }>(
      `SELECT
         COALESCE(SUM(net_effective_cash), 0.00)::NUMERIC(12, 2)::text AS cash_total,
         COALESCE(SUM(receipt_count), 0)::int AS receipt_count
       FROM public.daily_cash_reconciliation_view
       WHERE business_date BETWEEN $1::date AND $2::date`,
      [dateFrom, dateTo]
    ),
    pool.query<{ outstanding: string; open_count: number }>(
      `SELECT
         COALESCE(SUM(balance_due), 0.00)::NUMERIC(12, 2)::text AS outstanding,
         COUNT(*)::int AS open_count
       FROM public.invoice_ledger_view
       WHERE invoice_status = 'ISSUED' AND balance_due > 0.00`
    ),
    pool.query<{ exp_total: string }>(
      `SELECT COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2)::text AS exp_total
       FROM public.operational_expenses
       WHERE expense_date BETWEEN $1::date AND $2::date`,
      [dateFrom, dateTo]
    ),
    pool.query<{ liability_total: string }>(
      `SELECT COALESCE(SUM(pe.net_payable), 0.00)::NUMERIC(12, 2)::text AS liability_total
       FROM public.payroll_entries pe
       JOIN public.payroll_periods pp ON pp.id = pe.payroll_period_id
       WHERE pe.status = 'APPROVED'
         AND pp.end_date BETWEEN $1::date AND $2::date`,
      [dateFrom, dateTo]
    ),
    pool.query<{ salary_paid: string }>(
      `SELECT COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2)::text AS salary_paid
       FROM public.salary_payments
       WHERE payment_date BETWEEN $1::date AND $2::date`,
      [dateFrom, dateTo]
    ),
    pool.query<{
      business_date: string;
      invoice_count: number;
      billed_total: string;
      cash_collected: string;
    }>(
      `WITH keys AS (
         SELECT business_date FROM public.invoice_ledger_view
         WHERE invoice_status = 'ISSUED' AND business_date BETWEEN $1::date AND $2::date
         UNION
         SELECT business_date FROM public.daily_cash_reconciliation_view
         WHERE business_date BETWEEN $1::date AND $2::date
       ),
       inv_daily AS (
         SELECT business_date, COUNT(*)::int AS invoice_count,
                COALESCE(SUM(effective_grand_total), 0.00)::NUMERIC(12, 2) AS billed_total
         FROM public.invoice_ledger_view
         WHERE invoice_status = 'ISSUED' AND business_date BETWEEN $1::date AND $2::date
         GROUP BY business_date
       ),
       cash_daily AS (
         SELECT business_date, net_effective_cash
         FROM public.daily_cash_reconciliation_view
         WHERE business_date BETWEEN $1::date AND $2::date
       )
       SELECT
         k.business_date::text AS business_date,
         COALESCE(id.invoice_count, 0)::int AS invoice_count,
         COALESCE(id.billed_total, 0.00)::NUMERIC(12, 2)::text AS billed_total,
         COALESCE(cd.net_effective_cash, 0.00)::NUMERIC(12, 2)::text AS cash_collected
       FROM keys k
       LEFT JOIN inv_daily id ON id.business_date = k.business_date
       LEFT JOIN cash_daily cd ON cd.business_date = k.business_date
       ORDER BY k.business_date DESC`,
      [dateFrom, dateTo]
    ),
    pool.query<{
      user_id: string;
      full_name: string;
      receipt_count: number;
      physical_cash: string;
    }>(
      `SELECT
         user_id,
         full_name,
         COALESCE(SUM(receipt_count), 0)::int AS receipt_count,
         COALESCE(SUM(physical_cash_movement), 0.00)::NUMERIC(12, 2)::text AS physical_cash
       FROM public.cashier_shift_reconciliation_view
       WHERE shift_date BETWEEN $1::date AND $2::date
       GROUP BY user_id, full_name
       ORDER BY LOWER(full_name) ASC`,
      [dateFrom, dateTo]
    ),
    pool.query<{ category: string; total_amount: string; entry_count: number }>(
      `SELECT
         category,
         COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2)::text AS total_amount,
         COUNT(*)::int AS entry_count
       FROM public.operational_expenses
       WHERE expense_date BETWEEN $1::date AND $2::date
       GROUP BY category
       ORDER BY SUM(amount) DESC`,
      [dateFrom, dateTo]
    ),
  ]);

  return {
    dateFrom,
    dateTo,
    billedSalesTotal: totalsRes.rows[0].billed_total,
    issuedInvoiceCount: totalsRes.rows[0].inv_count,
    cashCollectedTotal: cashTotalsRes.rows[0].cash_total,
    receiptCount: cashTotalsRes.rows[0].receipt_count,
    outstandingReceivablesTotal: outstandingRes.rows[0].outstanding,
    openInvoicesCount: outstandingRes.rows[0].open_count,
    recordedExpensesTotal: expensesTotalRes.rows[0].exp_total,
    payrollApprovedLiabilityTotal: payrollLiabilityRes.rows[0].liability_total,
    payrollCashPaidTotal: payrollPaidRes.rows[0].salary_paid,
    dailySales: dailySalesRes.rows.map((r) => ({
      businessDate: r.business_date,
      invoiceCount: r.invoice_count,
      billedTotal: r.billed_total,
      cashCollectedTotal: r.cash_collected,
    })),
    cashierCollections: cashiersRes.rows.map((r) => ({
      userId: r.user_id,
      fullName: r.full_name,
      receiptCount: r.receipt_count,
      physicalCashMovement: r.physical_cash,
    })),
    expensesBreakdown: expensesBreakdownRes.rows.map((r) => ({
      category: r.category,
      totalAmount: r.total_amount,
      entryCount: r.entry_count,
    })),
  };
}

export async function fetchOperationsReport(
  pool: Pool,
  dateFrom: string,
  dateTo: string
): Promise<OperationsReportSummary> {
  const [
    attAgg,
    machAgg,
    prodAgg,
    pendingCounts,
    prodByMat,
    prodByMach,
    machSummary,
  ] = await Promise.all([
    pool.query<{ days: number; hrs: string; ot: string }>(
      `SELECT
         COUNT(*)::int AS days,
         COALESCE(SUM(hours_worked), 0.00)::NUMERIC(8, 2)::text AS hrs,
         COALESCE(SUM(overtime_hours), 0.00)::NUMERIC(8, 2)::text AS ot
       FROM public.worker_attendance
       WHERE approval_status = 'APPROVED'
         AND work_date BETWEEN $1::date AND $2::date`,
      [dateFrom, dateTo]
    ),
    pool.query<{ net_hrs: string; dt_min: number }>(
      `SELECT
         COALESCE(SUM(net_operating_hours), 0.00)::NUMERIC(8, 2)::text AS net_hrs,
         COALESCE(SUM(downtime_minutes), 0)::int AS dt_min
       FROM public.machine_work_logs
       WHERE approval_status = 'APPROVED'
         AND work_date BETWEEN $1::date AND $2::date`,
      [dateFrom, dateTo]
    ),
    pool.query<{ total_m3: string }>(
      `SELECT COALESCE(SUM(quantity_produced), 0.000)::NUMERIC(12, 3)::text AS total_m3
       FROM public.production_logs
       WHERE approval_status = 'APPROVED'
         AND production_date BETWEEN $1::date AND $2::date`,
      [dateFrom, dateTo]
    ),
    pool.query<{ att_p: number; mach_p: number; prod_p: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM public.worker_attendance WHERE approval_status = 'SUBMITTED') AS att_p,
         (SELECT COUNT(*)::int FROM public.machine_work_logs WHERE approval_status = 'SUBMITTED') AS mach_p,
         (SELECT COUNT(*)::int FROM public.production_logs WHERE approval_status = 'SUBMITTED') AS prod_p`
    ),
    pool.query<{ material_id: number; material_name: string; qty: string; cnt: number }>(
      `SELECT
         mat.id AS material_id,
         mat.name AS material_name,
         COALESCE(SUM(p.quantity_produced), 0.000)::NUMERIC(12, 3)::text AS qty,
         COUNT(*)::int AS cnt
       FROM public.production_logs p
       JOIN public.materials mat ON mat.id = p.material_id
       WHERE p.approval_status = 'APPROVED'
         AND p.production_date BETWEEN $1::date AND $2::date
       GROUP BY mat.id, mat.name
       ORDER BY SUM(p.quantity_produced) DESC`,
      [dateFrom, dateTo]
    ),
    pool.query<{ machine_id: number | null; machine_name: string; qty: string; cnt: number }>(
      `SELECT
         p.machine_id,
         COALESCE(m.machine_name, 'Unassigned / General') AS machine_name,
         COALESCE(SUM(p.quantity_produced), 0.000)::NUMERIC(12, 3)::text AS qty,
         COUNT(*)::int AS cnt
       FROM public.production_logs p
       LEFT JOIN public.machines m ON m.id = p.machine_id
       WHERE p.approval_status = 'APPROVED'
         AND p.production_date BETWEEN $1::date AND $2::date
       GROUP BY p.machine_id, m.machine_name
       ORDER BY SUM(p.quantity_produced) DESC`,
      [dateFrom, dateTo]
    ),
    pool.query<{
      machine_id: number;
      machine_name: string;
      net_hrs: string;
      dt_min: number;
      sched_hrs: string | null;
    }>(
      `SELECT
         m.id AS machine_id,
         m.machine_name,
         COALESCE(SUM(ml.net_operating_hours), 0.00)::NUMERIC(8, 2)::text AS net_hrs,
         COALESCE(SUM(ml.downtime_minutes), 0)::int AS dt_min,
         CASE
           WHEN COUNT(*) FILTER (WHERE ml.scheduled_hours IS NOT NULL) = COUNT(*) AND COUNT(*) > 0
             THEN SUM(ml.scheduled_hours)::NUMERIC(8, 2)::text
           ELSE NULL
         END AS sched_hrs
       FROM public.machine_work_logs ml
       JOIN public.machines m ON m.id = ml.machine_id
       WHERE ml.approval_status = 'APPROVED'
         AND ml.work_date BETWEEN $1::date AND $2::date
       GROUP BY m.id, m.machine_name
       ORDER BY LOWER(m.machine_name) ASC`,
      [dateFrom, dateTo]
    ),
  ]);

  return {
    dateFrom,
    dateTo,
    approvedAttendanceDays: attAgg.rows[0].days,
    approvedWorkerHours: attAgg.rows[0].hrs,
    approvedOvertimeHours: attAgg.rows[0].ot,
    approvedMachineHours: machAgg.rows[0].net_hrs,
    approvedMachineDowntimeMinutes: machAgg.rows[0].dt_min,
    approvedProductionTotalM3: prodAgg.rows[0].total_m3,
    pendingApprovalCounts: {
      attendance: pendingCounts.rows[0].att_p,
      machineLogs: pendingCounts.rows[0].mach_p,
      productionLogs: pendingCounts.rows[0].prod_p,
    },
    productionByMaterial: prodByMat.rows.map((r) => ({
      materialId: r.material_id,
      materialName: r.material_name,
      totalQuantityM3: r.qty,
      entryCount: r.cnt,
    })),
    productionByMachine: prodByMach.rows.map((r) => ({
      machineId: r.machine_id,
      machineName: r.machine_name,
      totalQuantityM3: r.qty,
      entryCount: r.cnt,
    })),
    machineSummary: machSummary.rows.map((r) => {
      let util: string | null = null;
      if (r.sched_hrs && Number(r.sched_hrs) > 0) {
        util = ((Number(r.net_hrs) / Number(r.sched_hrs)) * 100).toFixed(1);
      }
      return {
        machineId: r.machine_id,
        machineName: r.machine_name,
        netOperatingHours: r.net_hrs,
        downtimeMinutes: r.dt_min,
        scheduledHours: r.sched_hrs,
        utilizationPercent: util,
      };
    }),
  };
}

export async function fetchInvoicesExportRows(
  pool: Pool,
  dateFrom: string,
  dateTo: string
): Promise<Array<Record<string, string | number | null>>> {
  const res = await pool.query<Record<string, string | number | null>>(
    `SELECT
       ilv.invoice_number,
       ilv.business_date::text AS business_date,
       ilv.customer_name_snapshot AS customer_name,
       ilv.customer_phone_snapshot AS customer_phone,
       ilv.customer_location_snapshot AS customer_location,
       CASE WHEN ilv.has_transport THEN 'Yes' ELSE 'No' END AS has_transport,
       ilv.subtotal::NUMERIC(12, 2)::text AS subtotal_lkr,
       ilv.transport_fee::NUMERIC(12, 2)::text AS transport_fee_lkr,
       ilv.effective_grand_total::NUMERIC(12, 2)::text AS grand_total_lkr,
       ilv.effective_paid::NUMERIC(12, 2)::text AS paid_lkr,
       ilv.balance_due::NUMERIC(12, 2)::text AS balance_due_lkr,
       ilv.payment_status,
       ilv.invoice_status,
       u.full_name AS issued_by
     FROM public.invoice_ledger_view ilv
     JOIN public.users u ON u.id = ilv.issued_by_user_id
     WHERE ilv.business_date BETWEEN $1::date AND $2::date
     ORDER BY ilv.business_date DESC, ilv.invoice_id DESC`,
    [dateFrom, dateTo]
  );
  return res.rows;
}

export async function fetchCollectionsExportRows(
  pool: Pool,
  dateFrom: string,
  dateTo: string
): Promise<Array<Record<string, string | number | null>>> {
  const res = await pool.query<Record<string, string | number | null>>(
    `SELECT
       p.receipt_number,
       (p.created_at AT TIME ZONE 'Asia/Colombo')::date::text AS business_date,
       TO_CHAR(p.created_at AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') AS collected_at_colombo,
       ilv.invoice_number,
       ilv.customer_name_snapshot AS customer_name,
       p.amount::NUMERIC(12, 2)::text AS gross_amount_lkr,
       COALESCE(SUM(pa.adjustment_amount), 0.00)::NUMERIC(12, 2)::text AS adjusted_lkr,
       (p.amount - COALESCE(SUM(pa.adjustment_amount), 0.00))::NUMERIC(12, 2)::text AS net_amount_lkr,
       p.payment_method,
       u.full_name AS cashier_name,
       p.notes
     FROM public.payments p
     JOIN public.invoice_ledger_view ilv ON ilv.invoice_id = p.invoice_id
     JOIN public.users u ON u.id = p.cashier_user_id
     LEFT JOIN public.payment_adjustments pa ON pa.payment_id = p.id
     WHERE (p.created_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN $1::date AND $2::date
     GROUP BY p.id, p.receipt_number, p.created_at, ilv.invoice_number, ilv.customer_name_snapshot, p.amount, p.payment_method, u.full_name, p.notes
     ORDER BY p.created_at DESC, p.id DESC`,
    [dateFrom, dateTo]
  );
  return res.rows;
}

export async function fetchOutstandingExportRows(
  pool: Pool
): Promise<Array<Record<string, string | number | null>>> {
  const res = await pool.query<Record<string, string | number | null>>(
    `SELECT
       ilv.invoice_number,
       ilv.business_date::text AS business_date,
       ilv.customer_name_snapshot AS customer_name,
       ilv.customer_phone_snapshot AS customer_phone,
       ilv.customer_location_snapshot AS customer_location,
       ilv.effective_grand_total::NUMERIC(12, 2)::text AS grand_total_lkr,
       ilv.effective_paid::NUMERIC(12, 2)::text AS paid_lkr,
       ilv.balance_due::NUMERIC(12, 2)::text AS balance_due_lkr,
       ilv.payment_status
     FROM public.invoice_ledger_view ilv
     WHERE ilv.invoice_status = 'ISSUED' AND ilv.balance_due > 0.00
     ORDER BY ilv.business_date ASC, ilv.invoice_id ASC`
  );
  return res.rows;
}

export async function fetchAttendanceExportRows(
  pool: Pool,
  dateFrom: string,
  dateTo: string
): Promise<Array<Record<string, string | number | null>>> {
  const res = await pool.query<Record<string, string | number | null>>(
    `SELECT
       a.work_date::text AS work_date,
       w.worker_code,
       w.full_name AS worker_name,
       w.designation,
       TO_CHAR(a.start_time, 'HH24:MI') AS start_time,
       TO_CHAR(a.end_time, 'HH24:MI') AS end_time,
       CASE WHEN a.crosses_midnight THEN 'Yes' ELSE 'No' END AS overnight,
       a.break_minutes,
       a.hours_worked::NUMERIC(6, 2)::text AS hours_worked,
       a.overtime_hours::NUMERIC(6, 2)::text AS overtime_hours,
       a.approval_status,
       a.remarks
     FROM public.worker_attendance a
     JOIN public.workers w ON w.id = a.worker_id
     WHERE a.work_date BETWEEN $1::date AND $2::date
       AND a.approval_status = 'APPROVED'
     ORDER BY a.work_date DESC, LOWER(w.full_name) ASC`,
    [dateFrom, dateTo]
  );
  return res.rows;
}

export async function fetchMachineLogsExportRows(
  pool: Pool,
  dateFrom: string,
  dateTo: string
): Promise<Array<Record<string, string | number | null>>> {
  const res = await pool.query<Record<string, string | number | null>>(
    `SELECT
       ml.work_date::text AS work_date,
       m.machine_code,
       m.machine_name,
       m.machine_type,
       COALESCE(w.full_name, '') AS operator_name,
       TO_CHAR(ml.start_time, 'HH24:MI') AS start_time,
       TO_CHAR(ml.end_time, 'HH24:MI') AS end_time,
       ml.downtime_minutes,
       COALESCE(ml.downtime_reason, '') AS downtime_reason,
       ml.net_operating_hours::NUMERIC(6, 2)::text AS net_operating_hours,
       COALESCE(ml.scheduled_hours::NUMERIC(6, 2)::text, '') AS scheduled_hours,
       ml.approval_status
     FROM public.machine_work_logs ml
     JOIN public.machines m ON m.id = ml.machine_id
     LEFT JOIN public.workers w ON w.id = ml.operator_worker_id
     WHERE ml.work_date BETWEEN $1::date AND $2::date
       AND ml.approval_status = 'APPROVED'
     ORDER BY ml.work_date DESC, LOWER(m.machine_name) ASC`,
    [dateFrom, dateTo]
  );
  return res.rows;
}

export async function fetchProductionExportRows(
  pool: Pool,
  dateFrom: string,
  dateTo: string
): Promise<Array<Record<string, string | number | null>>> {
  const res = await pool.query<Record<string, string | number | null>>(
    `SELECT
       p.production_date::text AS production_date,
       mat.code AS material_code,
       mat.name AS material_name,
       COALESCE(m.machine_name, 'General / Unassigned') AS machine_name,
       COALESCE(w.full_name, '') AS operator_name,
       COALESCE(p.shift_label, '') AS shift_label,
       p.quantity_produced::NUMERIC(10, 3)::text AS quantity_m3,
       p.approval_status,
       COALESCE(p.remarks, '') AS remarks
     FROM public.production_logs p
     JOIN public.materials mat ON mat.id = p.material_id
     LEFT JOIN public.machines m ON m.id = p.machine_id
     LEFT JOIN public.workers w ON w.id = p.operator_worker_id
     WHERE p.production_date BETWEEN $1::date AND $2::date
       AND p.approval_status = 'APPROVED'
     ORDER BY p.production_date DESC, LOWER(mat.name) ASC`,
    [dateFrom, dateTo]
  );
  return res.rows;
}

export async function fetchPayrollExportRows(
  pool: Pool,
  dateFrom: string,
  dateTo: string,
  periodId?: number
): Promise<Array<Record<string, string | number | null>>> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (periodId !== undefined) {
    params.push(periodId);
    conditions.push(`pp.id = $${params.length}`);
  } else {
    params.push(dateFrom, dateTo);
    conditions.push(`pp.end_date >= $1::date AND pp.start_date <= $2::date`);
  }

  const res = await pool.query<Record<string, string | number | null>>(
    `WITH paid_totals AS (
       SELECT payroll_entry_id, COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2) AS paid_amount
       FROM public.salary_payments
       GROUP BY payroll_entry_id
     )
     SELECT
       pp.period_label,
       pp.start_date::text AS start_date,
       pp.end_date::text AS end_date,
       w.worker_code,
       w.full_name AS worker_name,
       w.designation,
       pe.pay_arrangement_snapshot AS pay_arrangement,
       pe.calculation_mode,
       pe.approved_days_count,
       pe.approved_regular_hours::NUMERIC(8, 2)::text AS regular_hours,
       pe.approved_overtime_hours::NUMERIC(8, 2)::text AS overtime_hours,
       pe.base_pay::NUMERIC(12, 2)::text AS base_pay_lkr,
       pe.overtime_pay::NUMERIC(12, 2)::text AS overtime_pay_lkr,
       pe.allowances::NUMERIC(12, 2)::text AS allowances_lkr,
       pe.deductions::NUMERIC(12, 2)::text AS deductions_lkr,
       pe.advance_deduction::NUMERIC(12, 2)::text AS advance_deduction_lkr,
       pe.gross_pay::NUMERIC(12, 2)::text AS gross_pay_lkr,
       pe.net_payable::NUMERIC(12, 2)::text AS net_payable_lkr,
       COALESCE(pt.paid_amount, 0.00)::NUMERIC(12, 2)::text AS paid_lkr,
       GREATEST(pe.net_payable - COALESCE(pt.paid_amount, 0.00), 0.00)::NUMERIC(12, 2)::text AS remaining_lkr,
       pe.status
     FROM public.payroll_entries pe
     JOIN public.payroll_periods pp ON pp.id = pe.payroll_period_id
     JOIN public.workers w ON w.id = pe.worker_id
     LEFT JOIN paid_totals pt ON pt.payroll_entry_id = pe.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY pp.start_date DESC, LOWER(w.full_name) ASC`,
    params
  );
  return res.rows;
}
