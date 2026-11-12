import type { TabularExportPayload } from "../../utils/exports.js";
import type {
  FinancialReportSummary,
  OperationsReportSummary,
} from "./reports.repository.js";

export type GeneralReportExportType =
  | "invoices"
  | "collections"
  | "outstanding"
  | "attendance"
  | "machines"
  | "production"
  | "summary";

export function buildGeneralExportPayload(params: {
  type: GeneralReportExportType;
  dateFrom: string;
  dateTo: string;
  rows?: Array<Record<string, string | number | null>>;
  financial?: FinancialReportSummary;
  operations?: OperationsReportSummary;
}): TabularExportPayload {
  const periodLabel = `Period: ${params.dateFrom} to ${params.dateTo} (Asia/Colombo)`;

  switch (params.type) {
    case "invoices":
      return {
        title: "NPR Metal Crusher — Issued Invoices Report",
        subtitle: periodLabel,
        filenameBase: `npr-invoices-${params.dateFrom}-to-${params.dateTo}`,
        columns: [
          { key: "invoice_number", header: "Invoice #" },
          { key: "business_date", header: "Date" },
          { key: "customer_name", header: "Customer" },
          { key: "customer_phone", header: "Phone" },
          { key: "customer_location", header: "Location" },
          { key: "has_transport", header: "Transport" },
          { key: "subtotal_lkr", header: "Subtotal (LKR)", align: "right" },
          { key: "transport_fee_lkr", header: "Transport Fee (LKR)", align: "right" },
          { key: "grand_total_lkr", header: "Grand Total (LKR)", align: "right" },
          { key: "paid_lkr", header: "Paid (LKR)", align: "right" },
          { key: "balance_due_lkr", header: "Balance Due (LKR)", align: "right" },
          { key: "payment_status", header: "Payment Status" },
          { key: "invoice_status", header: "Invoice Status" },
          { key: "issued_by", header: "Issued By" },
        ],
        rows: params.rows ?? [],
      };

    case "collections":
      return {
        title: "NPR Metal Crusher — Cash Collections Report",
        subtitle: periodLabel,
        filenameBase: `npr-collections-${params.dateFrom}-to-${params.dateTo}`,
        columns: [
          { key: "receipt_number", header: "Receipt #" },
          { key: "collected_at_colombo", header: "Collected At (Colombo)" },
          { key: "invoice_number", header: "Invoice #" },
          { key: "customer_name", header: "Customer" },
          { key: "gross_amount_lkr", header: "Gross Cash (LKR)", align: "right" },
          { key: "adjusted_lkr", header: "Reversals/Adj (LKR)", align: "right" },
          { key: "net_amount_lkr", header: "Net Cash (LKR)", align: "right" },
          { key: "cashier_name", header: "Cashier" },
          { key: "notes", header: "Notes" },
        ],
        rows: params.rows ?? [],
      };

    case "outstanding":
      return {
        title: "NPR Metal Crusher — Outstanding Customer Balances",
        subtitle: `As of ${params.dateTo} (Asia/Colombo)`,
        filenameBase: `npr-outstanding-${params.dateTo}`,
        columns: [
          { key: "invoice_number", header: "Invoice #" },
          { key: "business_date", header: "Invoice Date" },
          { key: "customer_name", header: "Customer" },
          { key: "customer_phone", header: "Phone" },
          { key: "customer_location", header: "Location" },
          { key: "grand_total_lkr", header: "Grand Total (LKR)", align: "right" },
          { key: "paid_lkr", header: "Paid (LKR)", align: "right" },
          { key: "balance_due_lkr", header: "Balance Due (LKR)", align: "right" },
          { key: "payment_status", header: "Status" },
        ],
        rows: params.rows ?? [],
      };

    case "attendance":
      return {
        title: "NPR Metal Crusher — Approved Worker Attendance Report",
        subtitle: periodLabel,
        filenameBase: `npr-attendance-${params.dateFrom}-to-${params.dateTo}`,
        columns: [
          { key: "work_date", header: "Work Date" },
          { key: "worker_code", header: "Code" },
          { key: "worker_name", header: "Worker" },
          { key: "designation", header: "Designation" },
          { key: "start_time", header: "Start" },
          { key: "end_time", header: "End" },
          { key: "overnight", header: "Overnight" },
          { key: "break_minutes", header: "Break (m)", align: "right" },
          { key: "hours_worked", header: "Net Hours", align: "right" },
          { key: "overtime_hours", header: "Overtime (h)", align: "right" },
          { key: "remarks", header: "Remarks" },
        ],
        rows: params.rows ?? [],
      };

    case "machines":
      return {
        title: "NPR Metal Crusher — Approved Machine Working Hours",
        subtitle: periodLabel,
        filenameBase: `npr-machines-${params.dateFrom}-to-${params.dateTo}`,
        columns: [
          { key: "work_date", header: "Work Date" },
          { key: "machine_code", header: "Code" },
          { key: "machine_name", header: "Machine" },
          { key: "machine_type", header: "Type" },
          { key: "operator_name", header: "Operator" },
          { key: "start_time", header: "Start" },
          { key: "end_time", header: "End" },
          { key: "downtime_minutes", header: "Downtime (m)", align: "right" },
          { key: "downtime_reason", header: "Downtime Reason" },
          { key: "net_operating_hours", header: "Net Hours", align: "right" },
          { key: "scheduled_hours", header: "Scheduled (h)", align: "right" },
        ],
        rows: params.rows ?? [],
      };

    case "production":
      return {
        title: "NPR Metal Crusher — Approved Metal Production Report",
        subtitle: periodLabel,
        filenameBase: `npr-production-${params.dateFrom}-to-${params.dateTo}`,
        columns: [
          { key: "production_date", header: "Date" },
          { key: "material_code", header: "Code" },
          { key: "material_name", header: "Material" },
          { key: "machine_name", header: "Machine" },
          { key: "operator_name", header: "Operator" },
          { key: "shift_label", header: "Shift" },
          { key: "quantity_m3", header: "Quantity (m3)", align: "right" },
          { key: "remarks", header: "Remarks" },
        ],
        rows: params.rows ?? [],
      };

    case "summary": {
      const fin = params.financial;
      const ops = params.operations;
      const summaryRows: Array<Record<string, string | number>> = [
        { metric: "Report Period", value: `${params.dateFrom} to ${params.dateTo}`, notes: "Asia/Colombo business dates" },
        { metric: "Issued Invoices Count", value: fin?.issuedInvoiceCount ?? 0, notes: "Approved issued invoices in period" },
        { metric: "Billed Sales Total (LKR)", value: fin?.billedSalesTotal ?? "0.00", notes: "Effective grand total after credit notes" },
        { metric: "Cash Collected Total (LKR)", value: fin?.cashCollectedTotal ?? "0.00", notes: `${fin?.receiptCount ?? 0} cash receipts net of reversals` },
        { metric: "Total Open Receivables (LKR)", value: fin?.outstandingReceivablesTotal ?? "0.00", notes: `${fin?.openInvoicesCount ?? 0} open unpaid/partial invoices (current all-time)` },
        { metric: "Recorded Operating Expenses (LKR)", value: fin?.recordedExpensesTotal ?? "0.00", notes: "Recorded expenses only (excludes unentered workshop overhead)" },
        { metric: "Approved Payroll Liability (LKR)", value: fin?.payrollApprovedLiabilityTotal ?? "0.00", notes: "Approved payroll periods overlapping date range" },
        { metric: "Salary Cash Disbursed (LKR)", value: fin?.payrollCashPaidTotal ?? "0.00", notes: "Actual salary cash payments made in period" },
        { metric: "Approved Worker Shifts", value: ops?.approvedAttendanceDays ?? 0, notes: `${ops?.approvedWorkerHours ?? "0.00"} hrs worked (${ops?.approvedOvertimeHours ?? "0.00"} OT)` },
        { metric: "Approved Machine Operating Hours", value: ops?.approvedMachineHours ?? "0.00", notes: `${ops?.approvedMachineDowntimeMinutes ?? 0} downtime minutes` },
        { metric: "Approved Metal Production (m3)", value: ops?.approvedProductionTotalM3 ?? "0.000", notes: `Pending approvals excluded (${(ops?.pendingApprovalCounts.attendance ?? 0) + (ops?.pendingApprovalCounts.machineLogs ?? 0) + (ops?.pendingApprovalCounts.productionLogs ?? 0)} records)` },
      ];
      return {
        title: "NPR Metal Crusher — Executive Summary Report",
        subtitle: periodLabel,
        filenameBase: `npr-executive-summary-${params.dateFrom}-to-${params.dateTo}`,
        columns: [
          { key: "metric", header: "Metric" },
          { key: "value", header: "Value", align: "right" },
          { key: "notes", header: "Scope & Notes" },
        ],
        rows: summaryRows,
      };
    }
  }
}

export function buildPayrollExportPayload(params: {
  dateFrom: string;
  dateTo: string;
  periodId?: number;
  rows: Array<Record<string, string | number | null>>;
}): TabularExportPayload {
  return {
    title: "NPR Metal Crusher — CONFIDENTIAL OWNER Payroll Report",
    subtitle:
      params.periodId !== undefined
        ? `Payroll Period #${params.periodId}`
        : `Periods overlapping ${params.dateFrom} to ${params.dateTo}`,
    filenameBase:
      params.periodId !== undefined
        ? `npr-payroll-period-${params.periodId}`
        : `npr-payroll-${params.dateFrom}-to-${params.dateTo}`,
    columns: [
      { key: "period_label", header: "Period" },
      { key: "worker_code", header: "Code" },
      { key: "worker_name", header: "Worker" },
      { key: "designation", header: "Designation" },
      { key: "pay_arrangement", header: "Arrangement" },
      { key: "calculation_mode", header: "Mode" },
      { key: "approved_days_count", header: "Days", align: "right" },
      { key: "regular_hours", header: "Reg Hrs", align: "right" },
      { key: "overtime_hours", header: "OT Hrs", align: "right" },
      { key: "base_pay_lkr", header: "Base (LKR)", align: "right" },
      { key: "overtime_pay_lkr", header: "OT (LKR)", align: "right" },
      { key: "allowances_lkr", header: "Allow (LKR)", align: "right" },
      { key: "deductions_lkr", header: "Deduct (LKR)", align: "right" },
      { key: "advance_deduction_lkr", header: "Adv Ded (LKR)", align: "right" },
      { key: "net_payable_lkr", header: "Net (LKR)", align: "right" },
      { key: "paid_lkr", header: "Paid (LKR)", align: "right" },
      { key: "remaining_lkr", header: "Remaining (LKR)", align: "right" },
      { key: "status", header: "Status" },
    ],
    rows: params.rows,
  };
}

