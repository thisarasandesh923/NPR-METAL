import type { InvoiceDetail } from "../../../types/billing.ts";
import {
  formatColomboDateTime,
  formatLkr,
} from "../../../utils/formatters.ts";

interface InvoicePrintA5Props {
  invoice: InvoiceDetail;
}

function formatPaymentStatusLabel(status: InvoiceDetail["paymentStatus"]): string {
  switch (status) {
    case "PAID":
      return "PAID";
    case "PARTIALLY_PAID":
      return "PARTIALLY PAID";
    case "UNPAID":
      return "UNPAID";
    case "CANCELLED":
      return "CANCELLED";
    case "REFUND_DUE":
      return "REFUND DUE";
  }
}

export function InvoicePrintA5({ invoice }: InvoicePrintA5Props) {
  return (
    <section
      aria-label={`Printable A5 Invoice ${invoice.invoiceNumber}`}
      className="print-only-sheet bg-white text-[#092547]"
    >
      <div className="mx-auto max-w-[138mm] border border-slate-300 p-4 text-[11px] leading-snug">
        <header className="flex items-start justify-between border-b-2 border-[#092547] pb-3">
          <div>
            <h1 className="text-lg font-extrabold tracking-wide text-[#092547]">
              NPR METAL CRUSHER
            </h1>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
              Crushed Stone &amp; Quarry Aggregates · Kurunegala, Sri Lanka
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Cash / Credit Invoice
            </p>
            <p className="text-sm font-extrabold text-[#092547]">
              {invoice.invoiceNumber}
            </p>
          </div>
        </header>

        <div className="mt-3 grid grid-cols-2 gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Bill To Customer
            </p>
            <p className="mt-0.5 text-xs font-extrabold text-[#092547]">
              {invoice.customerName}
            </p>
            <p className="text-[10px] text-slate-700">
              Tel: {invoice.customerPhone}
            </p>
            <p className="text-[10px] text-slate-700">
              Location: {invoice.customerLocation}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Issue Details
            </p>
            <p className="mt-0.5 text-[10px] text-slate-700">
              Issued: <strong>{formatColomboDateTime(invoice.issuedAt)}</strong>
            </p>
            <p className="text-[10px] text-slate-700">
              Cashier: <strong>{invoice.issuedByName}</strong>
            </p>
            <p className="text-[10px] text-slate-700">
              Transport:{" "}
              <strong>
                {invoice.hasTransport ? "With Transport" : "Customer Pickup"}
              </strong>
            </p>
          </div>
        </div>

        <table className="mt-3 w-full border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-slate-400 bg-slate-100 text-left">
              <th className="px-2 py-1.5 font-bold">#</th>
              <th className="px-2 py-1.5 font-bold">Material</th>
              <th className="px-2 py-1.5 text-right font-bold">Qty (m³)</th>
              <th className="px-2 py-1.5 text-right font-bold">Unit Price</th>
              <th className="px-2 py-1.5 text-right font-bold">Total (LKR)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, idx) => (
              <tr key={item.id} className="border-b border-slate-200">
                <td className="px-2 py-1.5">{idx + 1}</td>
                <td className="px-2 py-1.5 font-bold">{item.materialName}</td>
                <td className="px-2 py-1.5 text-right">{item.quantity}</td>
                <td className="px-2 py-1.5 text-right">
                  {formatLkr(item.unitPrice)}
                </td>
                <td className="px-2 py-1.5 text-right font-bold">
                  {formatLkr(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex justify-between gap-4 border-b border-slate-200 pb-3">
          <div className="w-1/2">
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Payment Receipts ({invoice.payments.length})
            </p>
            {invoice.payments.length === 0 ? (
              <p className="mt-1 text-[10px] text-slate-600">
                No cash payments recorded yet.
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-[10px] text-slate-700">
                {invoice.payments.map((p) => (
                  <li key={p.id}>
                    {p.receiptNumber}: <strong>{formatLkr(p.amount)}</strong> (
                    {formatColomboDateTime(p.createdAt)})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="w-1/2 space-y-1 text-right text-[10px]">
            <div className="flex justify-between">
              <span className="text-slate-600">Subtotal:</span>
              <strong>{formatLkr(invoice.subtotal)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Transport Fee:</span>
              <strong>{formatLkr(invoice.transportFee)}</strong>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1 text-xs">
              <span className="font-extrabold">Grand Total:</span>
              <strong>{formatLkr(invoice.grandTotal)}</strong>
            </div>
            <div className="flex justify-between text-emerald-800">
              <span>Amount Paid:</span>
              <strong>{formatLkr(invoice.paidAmount)}</strong>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1 text-xs">
              <span className="font-extrabold">Outstanding Balance:</span>
              <strong>{formatLkr(invoice.balanceDue)}</strong>
            </div>
            <p className="pt-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em]">
              Status: {formatPaymentStatusLabel(invoice.paymentStatus)}
            </p>
          </div>
        </div>

        <footer className="mt-4 pt-2">
          <p className="text-[9px] text-slate-500">
            Official computer-generated invoice. Commercial line items and prices
            are permanently locked upon issuance.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-8 text-center text-[10px]">
            <div className="border-t border-slate-400 pt-1">
              Customer / Receiver Signature
            </div>
            <div className="border-t border-slate-400 pt-1">
              Authorized Cashier ({invoice.issuedByName})
            </div>
          </div>
        </footer>
      </div>
    </section>
  );
}
