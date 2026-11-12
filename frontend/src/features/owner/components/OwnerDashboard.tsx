import { useCallback, useEffect, useState } from "react";
import { fetchInvoices, fetchOwnerOverview } from "../../../api/billing.ts";
import { ApiError } from "../../../api/client.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import type { AuthUser } from "../../../types/auth.ts";
import type {
  InvoiceSummary,
  OwnerOverviewMetrics,
} from "../../../types/billing.ts";
import {
  formatColomboDateTime,
  formatLkr,
} from "../../../utils/formatters.ts";

interface OwnerDashboardProps {
  user: AuthUser;
  onOpenHistory: () => void;
  onSelectInvoice: (invoiceId: number) => void;
}

export function OwnerDashboard({
  user,
  onOpenHistory,
  onSelectInvoice,
}: OwnerDashboardProps) {
  const [overview, setOverview] = useState<OwnerOverviewMetrics | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load owner ledger overview."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
      <section className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        <div>
          <p className="mb-2 text-sm font-bold text-[#f58220]">
            Welcome, {user.fullName}
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#092547] md:text-[32px]">
            Owner Management Portal
          </h1>
          <p className="mt-2 text-sm text-slate-500 md:text-[15px]">
            Live sales, cash collection, and customer outstanding balances from PostgreSQL reporting views.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenHistory}
          className="flex min-h-12 items-center justify-center gap-2.5 rounded-xl bg-[#092547] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#103462]"
        >
          <Icon name="history" className="h-5 w-5 text-[#f58220]" />
          Search All Invoices &amp; Balances
        </button>
      </section>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700"
        >
          {error}
        </div>
      )}

      <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="stat-card relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="stat-icon stat-blue">
              <Icon name="sales" className="h-5 w-5" />
            </span>
            <span className="text-[11px] font-bold text-slate-400">
              {overview?.businessDate ?? "Colombo"}
            </span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-slate-400">
            Today&apos;s Billed Sales
          </p>
          <p className="mt-1.5 text-xl font-extrabold text-[#092547]">
            {loading || !overview ? "Loading..." : formatLkr(overview.todayBilledTotal)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {overview ? `${overview.todayInvoiceCount} invoice(s) today` : "—"}
          </p>
        </article>

        <article className="stat-card relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="stat-icon stat-green">
              <Icon name="cash" className="h-5 w-5" />
            </span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-slate-400">
            Cash Collected Today
          </p>
          <p className="mt-1.5 text-xl font-extrabold text-emerald-700">
            {loading || !overview ? "Loading..." : formatLkr(overview.todayCashCollected)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {overview ? `${overview.todayReceiptCount} cash receipt(s)` : "—"}
          </p>
        </article>

        <article className="stat-card relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="stat-icon bg-[#fff4ea] text-[#e77418]">
              <Icon name="balance" className="h-5 w-5" />
            </span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-slate-400">
            Outstanding Receivables
          </p>
          <p className="mt-1.5 text-xl font-extrabold text-[#e77418]">
            {loading || !overview
              ? "Loading..."
              : formatLkr(overview.totalOutstandingBalance)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {overview ? `${overview.openInvoicesCount} unpaid/partial invoice(s)` : "—"}
          </p>
        </article>

        <article className="stat-card relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="stat-icon bg-slate-100 text-[#092547]">
              <Icon name="documents" className="h-5 w-5" />
            </span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-slate-400">
            Total Saved Invoices
          </p>
          <p className="mt-1.5 text-xl font-extrabold text-[#092547]">
            {loading || !overview ? "Loading..." : overview.totalIssuedInvoicesCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Immutable issued contracts
          </p>
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_20px_rgba(15,39,71,.045)]">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center md:px-6">
          <div>
            <h2 className="text-lg font-extrabold text-[#092547]">
              Saved Invoices, Payments &amp; Balances
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Authoritative figures from PostgreSQL invoice ledger view
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenHistory}
            className="self-start text-sm font-bold text-[#e77418] hover:text-[#bc5810] sm:self-auto"
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
                    {inv.customerName} · {inv.customerPhone}
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
                          {inv.customerPhone} · {inv.customerLocation}
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

      <p className="mt-6 text-center text-[11px] text-slate-400">
        NPR Metal Crusher Management System · Owner Administration Portal
      </p>
    </div>
  );
}
