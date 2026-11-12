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
         COALESCE(SUM(dcr.physical_cash_movement), 0.00)::NUMERIC(12, 2)::text AS today_cash_collected,
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
