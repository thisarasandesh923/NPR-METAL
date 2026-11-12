import { useCallback, useEffect, useState } from "react";
import { fetchInvoices } from "../../../api/billing.ts";
import { ApiError } from "../../../api/client.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import type { InvoiceSummary } from "../../../types/billing.ts";
import {
  formatColomboDateTime,
  formatLkr,
} from "../../../utils/formatters.ts";

interface InvoiceHistoryPageProps {
  onSelectInvoice: (invoiceId: number) => void;
  onCreateInvoice: () => void;
}

export function InvoiceHistoryPage({
  onSelectInvoice,
  onCreateInvoice,
}: InvoiceHistoryPageProps) {
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchInvoices({
        q: searchQuery,
        status: statusFilter,
        limit: 100,
      });
      setInvoices(list);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load invoice history."
      );
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 150);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
      <section className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#f58220]">
            Authoritative Ledger
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#092547] md:text-[30px]">
            Issued Invoices &amp; Payments
          </h1>
        </div>
        <button
          type="button"
          onClick={onCreateInvoice}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#f58220] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#e77418]"
        >
          <Icon name="plus" className="h-4 w-4" />
          New Invoice
        </button>
      </section>

      <section className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row">
        <input
          type="search"
          aria-label="Search invoices by number, customer name, or phone"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search invoice number, customer name, or phone..."
          className="form-control flex-1"
        />
        <select
          aria-label="Filter by payment status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="form-control sm:w-52"
        >
          <option value="">All Statuses</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIALLY_PAID">Partially Paid</option>
          <option value="PAID">Paid</option>
        </select>
      </section>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700"
        >
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_20px_rgba(15,39,71,.045)]">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading invoices...</p>
        ) : invoices.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-base font-bold text-[#092547]">
              No matching invoices found
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Issued invoices saved to PostgreSQL will appear here for payment collection and A5 printing.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] border-collapse text-left">
              <thead>
                <tr className="bg-[#f8fafc]">
                  <th>Invoice No.</th>
                  <th>Customer</th>
                  <th>Issued At</th>
                  <th className="text-right">Grand Total</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Balance Due</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
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
                      <p className="font-bold text-[#092547]">{inv.customerName}</p>
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
                        Open / Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
