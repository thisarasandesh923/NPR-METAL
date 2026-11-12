import { useCallback, useEffect, useState } from "react";
import { fetchInvoices, fetchOwnerOverview } from "../../../api/billing.ts";
import { ApiError } from "../../../api/client.ts";
import {
  downloadGeneralReportExport,
  fetchFinancialReport,
  fetchOperationsReport,
} from "../../../api/operations.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import type { AppScreen, AuthUser } from "../../../types/auth.ts";
import type {
  InvoiceSummary,
  OwnerOverviewMetrics,
} from "../../../types/billing.ts";
import type {
  FinancialReportSummary,
  GeneralExportType,
  OperationsReportSummary,
  ReportExportFormat,
} from "../../../types/operations.ts";
import {
  formatColomboDateTime,
  formatLkr,
} from "../../../utils/formatters.ts";
import { colomboTodayIsoDate } from "../../operations/spreadsheetUtils.ts";

interface OwnerDashboardProps {
  user: AuthUser;
  onOpenHistory: () => void;
  onSelectInvoice: (invoiceId: number) => void;
  onNavigate?: (screen: AppScreen) => void;
}

type ReportTab = "overview" | "financial" | "operations";

export function OwnerDashboard({
  user,
  onOpenHistory,
  onSelectInvoice,
  onNavigate,
}: OwnerDashboardProps) {
  const today = colomboTodayIsoDate();
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 7)}-01`);
  const [dateTo, setDateTo] = useState(today);
  const [reportTab, setReportTab] = useState<ReportTab>("overview");

  const [overview, setOverview] = useState<OwnerOverviewMetrics | null>(null);
  const [financial, setFinancial] = useState<FinancialReportSummary | null>(null);
  const [operations, setOperations] = useState<OperationsReportSummary | null>(
    null
  );
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [metrics, recent] = await Promise.all([
        fetchOwnerOverview(),
        fetchInvoices({ limit: 15 }),
      ]);
      setOverview(metrics);
      setInvoices(recent);

      const [finRes, opsRes] = await Promise.allSettled([
        fetchFinancialReport(dateFrom, dateTo),
        fetchOperationsReport(dateFrom, dateTo),
      ]);
      if (finRes.status === "fulfilled") {
        setFinancial(finRes.value);
      }
      if (opsRes.status === "fulfilled") {
        setOperations(opsRes.value);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load owner ledger & operational analytics."
      );
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function applyPreset(preset: "today" | "week" | "month") {
    const t = colomboTodayIsoDate();
    if (preset === "today") {
      setDateFrom(t);
      setDateTo(t);
    } else if (preset === "week") {
      const d = new Date(`${t}T00:00:00Z`);
      const day = d.getUTCDay();
      const diff = (day === 0 ? 6 : day - 1);
      d.setUTCDate(d.getUTCDate() - diff);
      setDateFrom(d.toISOString().slice(0, 10));
      setDateTo(t);
    } else {
      setDateFrom(`${t.slice(0, 7)}-01`);
      setDateTo(t);
    }
  }

  async function handleExport(type: GeneralExportType, format: ReportExportFormat) {
    const key = `${type}-${format}`;
    setExportingKey(key);
    setError(null);
    try {
      await downloadGeneralReportExport({ type, format, dateFrom, dateTo });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to download report."
      );
    } finally {
      setExportingKey(null);
    }
  }

  const totalPendingApprovals = operations
    ? operations.pendingApprovalCounts.attendance +
      operations.pendingApprovalCounts.machineLogs +
      operations.pendingApprovalCounts.productionLogs
    : 0;

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
      <section className="mb-6 flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        <div>
          <p className="mb-1 text-sm font-bold text-[#f58220]">
            Welcome, {user.fullName}
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#092547] md:text-[32px]">
            Owner Management Portal
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Authoritative sales, cash collection, receivables, approved production &amp; workshop efficiency ({dateFrom} to {dateTo}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {totalPendingApprovals > 0 && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("approvals")}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-extrabold text-amber-900 hover:bg-amber-100"
            >
              Pending Approvals: {totalPendingApprovals} &rarr;
            </button>
          )}
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#092547] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#103462]"
          >
            <Icon name="history" className="h-4 w-4 text-[#f58220]" />
            Search All Invoices
          </button>
        </div>
      </section>

      {/* Date Filters & Tabs */}
      <section className="mb-6 flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center">
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {(
            [
              ["overview", "Today & Invoices"],
              ["financial", "Financial Report"],
              ["operations", "Operations & Production"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setReportTab(id)}
              className={`rounded-lg px-4 py-2 text-xs font-extrabold ${
                reportTab === id
                  ? "bg-[#092547] text-white"
                  : "text-slate-600 hover:text-[#092547]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => applyPreset("today")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold hover:bg-slate-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => applyPreset("week")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold hover:bg-slate-50"
          >
            This Week
          </button>
          <button
            type="button"
            onClick={() => applyPreset("month")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold hover:bg-slate-50"
          >
            This Month
          </button>
          <input
            type="date"
            aria-label="Report date from"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            aria-label="Report date to"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold"
          />
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700"
        >
          {error}
        </div>
      )}

      {/* Exports Strip */}
      <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Download Reports ({dateFrom} to {dateTo})
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["summary", "Executive Summary"],
                ["invoices", "Invoices"],
                ["collections", "Collections"],
                ["outstanding", "Outstanding"],
                ["attendance", "Attendance"],
                ["machines", "Machine Hrs"],
                ["production", "Production"],
              ] as const
            ).map(([type, label]) => (
              <div
                key={type}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1"
              >
                <span className="text-[11px] font-bold text-[#092547]">{label}:</span>
                {(["csv", "xlsx", "pdf"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    disabled={exportingKey === `${type}-${fmt}`}
                    onClick={() => void handleExport(type, fmt)}
                    className="rounded bg-white px-1.5 py-0.5 text-[10px] font-extrabold text-[#124f8c] shadow-xs hover:bg-[#edf3fa]"
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {reportTab === "financial" && financial ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Period Billed Sales</p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#092547]">
                {formatLkr(financial.billedSalesTotal)}
              </h3>
              <p className="mt-1 text-xs text-slate-500">{financial.issuedInvoiceCount} issued invoices</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Net Cash Collected</p>
              <h3 className="mt-2 text-2xl font-extrabold text-emerald-700">
                {formatLkr(financial.cashCollectedTotal)}
              </h3>
              <p className="mt-1 text-xs text-slate-500">{financial.receiptCount} receipts net of reversals</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Recorded Expenses</p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#092547]">
                {formatLkr(financial.recordedExpensesTotal)}
              </h3>
              <p className="mt-1 text-xs text-slate-500">Entered operating expenses only</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Salary Cash Disbursed</p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#f58220]">
                {formatLkr(financial.payrollCashPaidTotal)}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Approved payroll liability: {formatLkr(financial.payrollApprovedLiabilityTotal)}
              </p>
            </article>
          </div>

          <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs font-medium text-amber-900">
            Financial Integrity Note: Totals summarize issued invoices, net cash receipts, approved payroll liabilities, and recorded workshop expenses. Unrecorded indirect workshop overhead is not estimated.
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-extrabold text-[#092547]">
                Cashier Collections Breakdown
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="py-2">Cashier</th>
                    <th className="py-2 text-right">Receipts</th>
                    <th className="py-2 text-right">Cash Movement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {financial.cashierCollections.map((c) => (
                    <tr key={c.userId}>
                      <td className="py-2.5 font-bold text-[#092547]">{c.fullName}</td>
                      <td className="py-2.5 text-right">{c.receiptCount}</td>
                      <td className="py-2.5 text-right font-bold text-emerald-700">
                        {formatLkr(c.physicalCashMovement)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-extrabold text-[#092547]">
                Recorded Expenses by Category
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="py-2">Category</th>
                    <th className="py-2 text-right">Entries</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {financial.expensesBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-400">
                        No expenses recorded in this date range.
                      </td>
                    </tr>
                  ) : (
                    financial.expensesBreakdown.map((eb) => (
                      <tr key={eb.category}>
                        <td className="py-2.5 font-bold text-[#092547]">{eb.category}</td>
                        <td className="py-2.5 text-right">{eb.entryCount}</td>
                        <td className="py-2.5 text-right font-bold">{formatLkr(eb.totalAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : reportTab === "operations" && operations ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Approved Production</p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#092547]">
                {operations.approvedProductionTotalM3} m³
              </h3>
              <p className="mt-1 text-xs text-slate-500">Approved logs only</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Approved Worker Hours</p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#092547]">
                {operations.approvedWorkerHours} h
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {operations.approvedAttendanceDays} shifts ({operations.approvedOvertimeHours} h OT)
              </p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Approved Machine Hours</p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#092547]">
                {operations.approvedMachineHours} h
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Downtime: {operations.approvedMachineDowntimeMinutes} mins
              </p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Excluded Pending Submissions</p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#f58220]">
                {totalPendingApprovals}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Att: {operations.pendingApprovalCounts.attendance} &middot; Mach: {operations.pendingApprovalCounts.machineLogs} &middot; Prod: {operations.pendingApprovalCounts.productionLogs}
              </p>
            </article>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-extrabold text-[#092547]">
                Approved Output by Material
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="py-2">Material</th>
                    <th className="py-2 text-right">Entries</th>
                    <th className="py-2 text-right">Output (m³)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {operations.productionByMaterial.map((pm) => (
                    <tr key={pm.materialId}>
                      <td className="py-2.5 font-bold text-[#092547]">{pm.materialName}</td>
                      <td className="py-2.5 text-right">{pm.entryCount}</td>
                      <td className="py-2.5 text-right font-extrabold text-[#092547]">{pm.totalQuantityM3} m³</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-extrabold text-[#092547]">
                Machine Summary &amp; Utilization
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="py-2">Machine</th>
                    <th className="py-2 text-right">Net Hours</th>
                    <th className="py-2 text-right">Downtime</th>
                    <th className="py-2 text-right">Utilization</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {operations.machineSummary.map((ms) => (
                    <tr key={ms.machineId}>
                      <td className="py-2.5 font-bold text-[#092547]">{ms.machineName}</td>
                      <td className="py-2.5 text-right font-bold">{ms.netOperatingHours} h</td>
                      <td className="py-2.5 text-right">{ms.downtimeMinutes} m</td>
                      <td className="py-2.5 text-right">
                        {ms.utilizationPercent ? `${ms.utilizationPercent}%` : "Not Scheduled"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>
          <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="stat-card relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="stat-icon stat-blue">
                  <Icon name="sales" className="h-5 w-5" />
                </span>
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                Today&apos;s Sales ({overview?.businessDate ?? "Colombo"})
              </p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#092547]">
                {loading ? "..." : formatLkr(overview?.todayBilledTotal ?? "0.00")}
              </h3>
              <p className="mt-1.5 text-xs text-slate-500">
                {overview ? `${overview.todayInvoiceCount} issued today` : "Loading..."}
              </p>
            </article>

            <article className="stat-card relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="stat-icon stat-green">
                  <Icon name="cash" className="h-5 w-5" />
                </span>
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                Today&apos;s Net Cash Collected
              </p>
              <h3 className="mt-2 text-2xl font-extrabold text-emerald-700">
                {loading ? "..." : formatLkr(overview?.todayCashCollected ?? "0.00")}
              </h3>
              <p className="mt-1.5 text-xs text-slate-500">
                {overview ? `${overview.todayReceiptCount} cash receipts today` : "Loading..."}
              </p>
            </article>

            <article className="stat-card relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="stat-icon stat-orange">
                  <Icon name="balance" className="h-5 w-5" />
                </span>
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                Total Customer Receivables
              </p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#e77418]">
                {loading ? "..." : formatLkr(overview?.totalOutstandingBalance ?? "0.00")}
              </h3>
              <p className="mt-1.5 text-xs text-slate-500">
                {overview ? `${overview.openInvoicesCount} unpaid/partial invoices` : "Loading..."}
              </p>
            </article>

            <article className="stat-card relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="stat-icon stat-navy">
                  <Icon name="documents" className="h-5 w-5" />
                </span>
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                Total Issued Invoices
              </p>
              <h3 className="mt-2 text-2xl font-extrabold text-[#092547]">
                {loading ? "..." : String(overview?.totalIssuedInvoicesCount ?? 0)}
              </h3>
              <p className="mt-1.5 text-xs text-slate-500">
                Immutable historical ledger
              </p>
            </article>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-[#092547]">
                  Recent Invoices &amp; Balances
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Real-time persisted invoices including partially paid and fully settled sales.
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenHistory}
                className="text-sm font-bold text-[#124f8c] hover:underline"
              >
                View All &rarr;
              </button>
            </div>

            {loading ? (
              <p className="p-6 text-sm text-slate-500">Loading saved invoices...</p>
            ) : invoices.length === 0 ? (
              <p className="p-8 text-center text-sm font-semibold text-slate-500">
                No issued invoices recorded in the database yet.
              </p>
            ) : (
              <>
                <div className="divide-y divide-slate-100 md:hidden">
                  {invoices.map((inv) => (
                    <div key={inv.id} className="space-y-2 p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-[#124f8c]">
                          {inv.invoiceNumber}
                        </span>
                        <span className="text-xs font-bold text-slate-500">
                          {inv.paymentStatus.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-[#092547]">
                        {inv.customerName} &middot; {inv.customerPhone}
                      </p>
                      <div className="flex justify-between text-xs">
                        <span>Total: {formatLkr(inv.grandTotal)}</span>
                        <span className="font-bold text-[#e77418]">
                          Due: {formatLkr(inv.balanceDue)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectInvoice(inv.id)}
                        className="w-full rounded-xl bg-[#edf3fa] py-2 text-xs font-bold text-[#124f8c]"
                      >
                        Inspect / Print
                      </button>
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-[#f8fafc]">
                        <th>Invoice No.</th>
                        <th>Customer</th>
                        <th>Issued</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Paid</th>
                        <th className="text-right">Balance Due</th>
                        <th>Status</th>
                        <th className="text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr
                          key={inv.id}
                          className="border-t border-slate-100 transition hover:bg-slate-50/70"
                        >
                          <td className="font-extrabold text-[#124f8c]">
                            {inv.invoiceNumber}
                          </td>
                          <td>
                            <p className="font-bold text-[#092547]">
                              {inv.customerName}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {inv.customerPhone} &middot; {inv.customerLocation}
                            </p>
                          </td>
                          <td className="text-slate-500">
                            {formatColomboDateTime(inv.issuedAt)}
                          </td>
                          <td className="text-right font-bold text-[#092547]">
                            {formatLkr(inv.grandTotal)}
                          </td>
                          <td className="text-right font-bold text-emerald-700">
                            {formatLkr(inv.paidAmount)}
                          </td>
                          <td className="text-right font-extrabold text-[#e77418]">
                            {formatLkr(inv.balanceDue)}
                          </td>
                          <td>
                            <span
                              className={`status ${
                                inv.paymentStatus === "PAID"
                                  ? "status-paid"
                                  : inv.paymentStatus === "PARTIALLY_PAID"
                                    ? "status-partial"
                                    : "status-due"
                              }`}
                            >
                              <span />
                              {inv.paymentStatus.replace("_", " ")}
                            </span>
                          </td>
                          <td className="text-right">
                            <button
                              type="button"
                              onClick={() => onSelectInvoice(inv.id)}
                              className="rounded-lg bg-[#edf3fa] px-3 py-1.5 text-xs font-bold text-[#124f8c] hover:bg-[#dce8f6]"
                            >
                              Inspect / Print
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <p className="mt-6 text-center text-[11px] text-slate-400">
        NPR Metal Crusher Management System &middot; Owner Administration Portal
      </p>
    </div>
  );
}
