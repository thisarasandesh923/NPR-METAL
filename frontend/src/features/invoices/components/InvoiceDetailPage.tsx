import { useCallback, useEffect, useState } from "react";
import { fetchInvoiceDetail } from "../../../api/billing.ts";
import { ApiError } from "../../../api/client.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import type { InvoiceDetail } from "../../../types/billing.ts";
import {
  formatColomboDateTime,
  formatLkr,
} from "../../../utils/formatters.ts";
import { InvoicePrintA5 } from "./InvoicePrintA5.tsx";
import { RecordPaymentModal } from "./RecordPaymentModal.tsx";

interface InvoiceDetailPageProps {
  invoiceId?: number;
  initialInvoice?: InvoiceDetail;
  onBack: () => void;
  onCreateAnother?: () => void;
}

function getStatusClasses(status: InvoiceDetail["paymentStatus"]): string {
  switch (status) {
    case "PAID":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "PARTIALLY_PAID":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "UNPAID":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

export function InvoiceDetailPage({
  invoiceId,
  initialInvoice,
  onBack,
  onCreateAnother,
}: InvoiceDetailPageProps) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(
    initialInvoice ?? null
  );
  const [loading, setLoading] = useState(!initialInvoice && Boolean(invoiceId));
  const [error, setError] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSuccessNotice, setPaymentSuccessNotice] = useState<
    string | null
  >(null);

  const loadFromServer = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const fresh = await fetchInvoiceDetail(id);
      setInvoice(fresh);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load invoice details."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (invoiceId !== undefined && (!initialInvoice || initialInvoice.id !== invoiceId)) {
      void loadFromServer(invoiceId);
    }
  }, [initialInvoice, invoiceId, loadFromServer]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] p-6 md:p-10">
        <p className="text-sm font-semibold text-slate-500">
          Loading persisted invoice record...
        </p>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="mx-auto max-w-[1200px] p-6 md:p-10">
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-white p-6"
        >
          <p className="font-bold text-rose-700">
            {error ?? "Invoice not found."}
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-4 rounded-xl bg-[#092547] px-4 py-2.5 text-xs font-bold text-white"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const canRecordPayment =
    invoice.invoiceStatus === "ISSUED" && Number(invoice.balanceDue) > 0;

  return (
    <>
      <div className="no-print mx-auto max-w-[1250px] p-4 md:p-8 lg:p-10">
        {paymentSuccessNotice && (
          <div
            role="status"
            className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-900"
          >
            <Icon name="check" className="h-5 w-5 shrink-0 text-emerald-600" />
            <span>{paymentSuccessNotice}</span>
          </div>
        )}

        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#f58220]">
              Permanent Issued Invoice
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-extrabold text-[#092547] md:text-3xl">
                {invoice.invoiceNumber}
              </h1>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-extrabold ${getStatusClasses(invoice.paymentStatus)}`}
              >
                {invoice.paymentStatus.replace("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Issued {formatColomboDateTime(invoice.issuedAt)} by{" "}
              <strong>{invoice.issuedByName}</strong>
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            {onCreateAnother && (
              <button
                type="button"
                onClick={onCreateAnother}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-[#092547] hover:bg-slate-50"
              >
                + New Invoice
              </button>
            )}
            {canRecordPayment && (
              <button
                type="button"
                onClick={() => setShowPaymentModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#124f8c] px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0d3f72]"
              >
                <Icon name="cash" className="h-4 w-4" />
                Record Cash Payment
              </button>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#f58220] px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#e77418]"
            >
              <Icon name="print" className="h-4 w-4" />
              Print A5 Invoice
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.06em] text-slate-400">
                Customer &amp; Delivery Snapshot
              </h2>
              <p className="mt-2 text-lg font-extrabold text-[#092547]">
                {invoice.customerName}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Phone: <strong>{invoice.customerPhone}</strong> · Location:{" "}
                <strong>{invoice.customerLocation}</strong>
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Transport:{" "}
                <strong>
                  {invoice.hasTransport
                    ? `With Transport (${formatLkr(invoice.transportFee)})`
                    : "Without Transport (Customer Pickup)"}
                </strong>
              </p>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="text-base font-extrabold text-[#092547]">
                  Frozen Line Items
                </h2>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                  <Icon name="lock" className="h-3.5 w-3.5" />
                  Immutable Snapshot
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-[#f8fafc]">
                      <th>#</th>
                      <th>Material</th>
                      <th className="text-right">Quantity (m³)</th>
                      <th className="text-right">Unit Price</th>
                      <th className="text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item, idx) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="font-bold text-slate-400">{idx + 1}</td>
                        <td className="font-bold text-[#092547]">
                          {item.materialName}
                        </td>
                        <td className="text-right font-semibold">
                          {item.quantity} m³
                        </td>
                        <td className="text-right">{formatLkr(item.unitPrice)}</td>
                        <td className="text-right font-extrabold text-[#092547]">
                          {formatLkr(item.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="text-base font-extrabold text-[#092547]">
                  Append-Only Cash Payment History ({invoice.payments.length})
                </h2>
                <span className="text-xs text-slate-400">Cash Only</span>
              </div>
              {invoice.payments.length === 0 ? (
                <p className="p-5 text-xs text-slate-500">
                  No cash payments have been recorded against this invoice yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-[#f8fafc]">
                        <th>Receipt No.</th>
                        <th>Received By</th>
                        <th>Date / Time (Colombo)</th>
                        <th>Notes</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.payments.map((pay) => (
                        <tr key={pay.id} className="border-t border-slate-100">
                          <td className="font-extrabold text-[#124f8c]">
                            {pay.receiptNumber}
                          </td>
                          <td className="font-semibold text-slate-700">
                            {pay.cashierName}
                          </td>
                          <td className="text-slate-500">
                            {formatColomboDateTime(pay.createdAt)}
                          </td>
                          <td className="text-slate-500">
                            {pay.notes ?? "—"}
                          </td>
                          <td className="text-right font-extrabold text-emerald-700">
                            {formatLkr(pay.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="h-fit rounded-2xl bg-[#092547] p-6 text-white shadow-lg">
            <h2 className="border-b border-white/10 pb-4 text-base font-extrabold">
              Authoritative Totals
            </h2>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between text-blue-100/75">
                <span>Subtotal</span>
                <strong className="text-white">{formatLkr(invoice.subtotal)}</strong>
              </div>
              <div className="flex justify-between text-blue-100/75">
                <span>Transport Fee</span>
                <strong className="text-white">
                  {formatLkr(invoice.transportFee)}
                </strong>
              </div>
              <div className="flex justify-between border-t border-dashed border-white/20 pt-3">
                <span className="font-bold">Grand Total</span>
                <strong className="text-xl font-extrabold text-[#ff9b43]">
                  {formatLkr(invoice.grandTotal)}
                </strong>
              </div>
              <div className="flex justify-between text-blue-100/75">
                <span>Total Paid</span>
                <strong className="text-emerald-300">
                  {formatLkr(invoice.paidAmount)}
                </strong>
              </div>
              <div className="rounded-xl bg-white/[0.08] p-4">
                <div className="flex items-end justify-between">
                  <span className="text-xs font-bold text-blue-100/80">
                    Outstanding Balance
                  </span>
                  <strong className="text-lg font-extrabold">
                    {formatLkr(invoice.balanceDue)}
                  </strong>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <InvoicePrintA5 invoice={invoice} />

      {showPaymentModal && (
        <RecordPaymentModal
          invoice={invoice}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={(updatedInvoice, receiptNumber) => {
            setInvoice(updatedInvoice);
            setShowPaymentModal(false);
            setPaymentSuccessNotice(
              `Cash payment recorded cleanly (${receiptNumber}). Updated balance: ${formatLkr(updatedInvoice.balanceDue)}.`
            );
          }}
        />
      )}
    </>
  );
}
