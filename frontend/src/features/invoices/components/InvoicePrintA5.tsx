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
      return "PAID / සම්පූර්ණයෙන් ගෙවා ඇත";
    case "PARTIALLY_PAID":
      return "PARTIALLY PAID / කොටසක් ගෙවා ඇත";
    case "UNPAID":
      return "UNPAID / නොගෙවූ (ණය)";
    case "CANCELLED":
      return "CANCELLED / අවලංගුයි";
    case "REFUND_DUE":
      return "REFUND DUE / මුදල් ආපසු ගෙවිය යුතුයි";
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
            <p className="text-[10px] font-semibold text-slate-700">
              එන්.පී.ආර්. මෙටල් ක්‍රෂර් · Kurunegala, Sri Lanka
            </p>
            <p className="text-[9px] uppercase tracking-[0.08em] text-slate-500">
              Aggregates: 3/4&quot;, Dust, 6×9, ABC · Crushed Metal Quarry
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Invoice / බිල්පත
            </p>
            <p className="text-sm font-extrabold text-[#092547]">
              {invoice.invoiceNumber}
            </p>
          </div>
        </header>

        <div className="mt-3 grid grid-cols-2 gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Customer / පාරිභෝගිකයා
            </p>
            <p className="mt-0.5 text-xs font-extrabold text-[#092547]">
              {invoice.customerName}
            </p>
            <p className="text-[10px] text-slate-700">
              Tel / දුරකථනය: {invoice.customerPhone}
            </p>
            <p className="text-[10px] text-slate-700">
              Site / ස්ථානය: {invoice.customerLocation}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Issue Details / විස්තර
            </p>
            <p className="mt-0.5 text-[10px] text-slate-700">
              Date / දිනය: <strong>{formatColomboDateTime(invoice.issuedAt)}</strong>
            </p>
            <p className="text-[10px] text-slate-700">
              Cashier / අයකැමි: <strong>{invoice.issuedByName}</strong>
            </p>
            <p className="text-[10px] text-slate-700">
              Transport / ප්‍රවාහනය:{" "}
              <strong>
                {invoice.hasTransport ? "With Transport (සහිතයි)" : "Customer Pickup (රහිතයි)"}
              </strong>
            </p>
          </div>
        </div>

        <table className="mt-3 w-full border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-slate-400 bg-slate-100 text-left">
              <th className="px-2 py-1.5 font-bold">#</th>
              <th className="px-2 py-1.5 font-bold">Material / ද්‍රව්‍යය</th>
              <th className="px-2 py-1.5 text-right font-bold">Qty / ප්‍රමාණය (m³)</th>
              <th className="px-2 py-1.5 text-right font-bold">Unit Price / ඒකක මිල</th>
              <th className="px-2 py-1.5 text-right font-bold">Total / මුළු මුදල</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, idx) => (
              <tr key={item.id} className="border-b border-slate-200">
                <td className="px-2 py-1.5">{idx + 1}</td>
                <td className="px-2 py-1.5 font-bold">{item.materialName}</td>
                <td className="px-2 py-1.5 text-right">{item.quantity} m³</td>
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
              Payment Receipts / ගෙවීම් රිසිට්පත් ({invoice.payments.length})
            </p>
            {invoice.payments.length === 0 ? (
              <p className="mt-1 text-[10px] text-slate-600">
                No cash payments recorded yet (ණය බිල්පතකි).
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
              <span className="text-slate-600">Subtotal / ද්‍රව්‍ය එකතුව:</span>
              <strong>{formatLkr(invoice.subtotal)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Transport / ප්‍රවාහන ගාස්තුව:</span>
              <strong>{formatLkr(invoice.transportFee)}</strong>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1 text-xs">
              <span className="font-extrabold">Grand Total / මුළු මුදල:</span>
              <strong className="text-[#092547]">{formatLkr(invoice.grandTotal)}</strong>
            </div>
            <div className="flex justify-between text-emerald-800">
              <span>Amount Paid / ගෙවූ මුදල:</span>
              <strong>{formatLkr(invoice.paidAmount)}</strong>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1 text-xs">
              <span className="font-extrabold">Balance Due / ඉතිරි මුදල:</span>
              <strong className="text-[#e77418]">{formatLkr(invoice.balanceDue)}</strong>
            </div>
            <p className="pt-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-600">
              Status: {formatPaymentStatusLabel(invoice.paymentStatus)}
            </p>
          </div>
        </div>

        <footer className="mt-4 pt-2">
          <p className="text-[9px] text-slate-500">
            Official computer-generated invoice. Commercial terms and prices are permanently locked upon issuance.
            නිල පරිගණක මුද්‍රිත බිල්පතකි. ස්තූතියි!
          </p>
          <div className="mt-6 grid grid-cols-2 gap-8 text-center text-[10px]">
            <div className="border-t border-slate-400 pt-1">
              Customer / Receiver Signature<br />
              <span className="text-[9px] text-slate-500">පාරිභෝගික / භාරගන්නාගේ අත්සන</span>
            </div>
            <div className="border-t border-slate-400 pt-1">
              Authorized Cashier ({invoice.issuedByName})<br />
              <span className="text-[9px] text-slate-500">බලයලත් මුදල් අයකැමි අත්සන</span>
            </div>
          </div>
        </footer>
      </div>
    </section>
  );
}
