import { useCallback, useEffect, useState } from "react";
import { fetchInvoices } from "../../../api/billing.ts";
import { ApiError } from "../../../api/client.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import { useLanguage } from "../../../i18n/LanguageContext.tsx";
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
  const { t } = useLanguage();
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

  const getStatusLabel = (status: InvoiceSummary["paymentStatus"]): string => {
    switch (status) {
      case "PAID":
        return t("statusPaid");
      case "PARTIALLY_PAID":
        return t("statusPartiallyPaid");
      case "UNPAID":
        return t("statusUnpaid");
      case "CANCELLED":
        return t("statusCancelled");
      default:
        return status;
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
      <section className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#f58220]">
            {t("workspaceLabel")}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#092547] md:text-[30px]">
            {t("invoiceHistoryTitle")}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {t("invoiceHistorySubtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateInvoice}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#f58220] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#e77418]"
        >
          <Icon name="plus" className="h-4 w-4" />
          {t("navNewInvoice")}
        </button>
      </section>

      <section className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row">
        <input
          type="search"
          aria-label={t("searchInvoicesPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("searchInvoicesPlaceholder")}
          className="form-control flex-1"
        />
        <select
          aria-label={t("filterStatus")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="form-control sm:w-52"
        >
          <option value="">{t("filterAll")}</option>
          <option value="UNPAID">{t("filterUnpaid")}</option>
          <option value="PARTIALLY_PAID">{t("filterPartiallyPaid")}</option>
          <option value="PAID">{t("filterPaid")}</option>
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
          <p className="p-6 text-sm text-slate-500">{t("loading")}</p>
        ) : invoices.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-base font-bold text-[#092547]">
              {t("noInvoicesYet")}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t("noInvoicesYetSubtitle")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] border-collapse text-left">
              <thead>
                <tr className="bg-[#f8fafc]">
                  <th>{t("invoiceNo")}</th>
                  <th>{t("customer")}</th>
                  <th>{t("issuedAt")}</th>
                  <th className="text-right">{t("grandTotal")}</th>
                  <th className="text-right">{t("paidAmount")}</th>
                  <th className="text-right">{t("balanceDue")}</th>
                  <th>{t("status")}</th>
                  <th className="text-right">{t("actions")}</th>
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
                        {getStatusLabel(inv.paymentStatus)}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => onSelectInvoice(inv.id)}
                        className="rounded-lg bg-[#edf3fa] px-3 py-1.5 text-xs font-bold text-[#124f8c] hover:bg-[#dce8f6]"
                      >
                        {t("viewInvoice")}
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
