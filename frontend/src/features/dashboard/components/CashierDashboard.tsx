import { useCallback, useEffect, useState } from "react";
import { fetchInvoices } from "../../../api/billing.ts";
import { ApiError } from "../../../api/client.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import { useLanguage } from "../../../i18n/LanguageContext.tsx";
import type { AuthUser } from "../../../types/auth.ts";
import type { InvoiceSummary } from "../../../types/billing.ts";
import {
  formatColomboDateTime,
  formatLkr,
} from "../../../utils/formatters.ts";

interface CashierDashboardProps {
  user: AuthUser;
  onCreateInvoice: () => void;
  onOpenHistory: () => void;
  onSelectInvoice: (invoiceId: number) => void;
}

function getFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return "Cashier";
  }
  return trimmed.split(/\s+/)[0];
}

export function CashierDashboard({
  user,
  onCreateInvoice,
  onOpenHistory,
  onSelectInvoice,
}: CashierDashboardProps) {
  const { t } = useLanguage();
  const firstName = getFirstName(user.fullName);
  const [recentInvoices, setRecentInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchInvoices({ limit: 10 });
      setRecentInvoices(list);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load saved invoices."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

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
      <section className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        <div>
          <p className="mb-2 text-sm font-bold text-[#f58220]">
            {t("welcomeCashier")}, {firstName}!
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#092547] md:text-[32px]">
            {t("cashierDashboardTitle")}
          </h1>
          <p className="mt-2 text-sm text-slate-500 md:text-[15px]">
            {t("signedInAs")}{" "}
            <span className="font-semibold text-[#092547]">{user.fullName}</span> (
            {user.role === "CASHIER" ? t("roleCashier") : t("roleOwner")}).
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-[#092547] shadow-sm transition hover:bg-slate-50"
          >
            <Icon name="history" className="h-5 w-5 text-[#124f8c]" />
            {t("invoiceHistoryAndPayments")}
          </button>
          <button
            type="button"
            onClick={onCreateInvoice}
            className="flex min-h-14 items-center justify-center gap-3 rounded-xl bg-[#f58220] px-6 text-[15px] font-bold text-white shadow-[0_10px_28px_rgba(245,130,32,.25)] transition hover:-translate-y-0.5 hover:bg-[#e77418] focus:outline-none focus:ring-4 focus:ring-orange-200"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20">
              <Icon name="plus" className="h-5 w-5" />
            </span>
            {t("createNewInvoice")}
          </button>
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

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_20px_rgba(15,39,71,.045)]">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center md:px-6">
          <div>
            <h2 className="text-lg font-extrabold text-[#092547]">
              {t("recentIssuedInvoices")}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {t("recentInvoicesSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex items-center gap-2 self-start text-sm font-bold text-[#e77418] transition hover:text-[#bc5810] sm:self-auto"
          >
            {t("viewFullHistory")}
            <Icon name="arrow" className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <p className="p-6 text-sm text-slate-500">
            {t("loading")}
          </p>
        ) : recentInvoices.length === 0 ? (
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
                {recentInvoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="border-t border-slate-100 transition hover:bg-slate-50/80"
                  >
                    <td className="font-extrabold text-[#124f8c]">
                      {invoice.invoiceNumber}
                    </td>
                    <td>
                      <p className="font-bold text-[#092547]">
                        {invoice.customerName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {invoice.customerPhone ?? "—"}
                      </p>
                    </td>
                    <td className="text-slate-500">
                      {formatColomboDateTime(invoice.issuedAt)}
                    </td>
                    <td className="text-right font-extrabold text-[#092547]">
                      {formatLkr(invoice.grandTotal)}
                    </td>
                    <td className="text-right font-bold text-emerald-600">
                      {formatLkr(invoice.paidAmount)}
                    </td>
                    <td className="text-right font-extrabold text-amber-600">
                      {formatLkr(invoice.balanceDue)}
                    </td>
                    <td>
                      <span
                        className={`status ${
                          invoice.paymentStatus === "PAID"
                            ? "status-paid"
                            : invoice.paymentStatus === "PARTIALLY_PAID"
                              ? "status-partial"
                              : "status-due"
                        }`}
                      >
                        <span />
                        {getStatusLabel(invoice.paymentStatus)}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => onSelectInvoice(invoice.id)}
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

      <p className="mt-6 text-center text-[11px] text-slate-400">
        NPR Metal Crusher Management System · {t("roleCashier")} {t("workspace")}
      </p>
    </div>
  );
}
