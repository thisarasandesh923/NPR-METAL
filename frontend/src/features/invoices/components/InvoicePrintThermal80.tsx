import type { InvoiceDetail } from "../../../types/billing.ts";
import {
  formatColomboDateTime,
  formatLkr,
} from "../../../utils/formatters.ts";

interface InvoicePrintThermal80Props {
  invoice: InvoiceDetail;
}

function formatStatus(status: InvoiceDetail["paymentStatus"]): string {
  switch (status) {
    case "PAID":
      return "PAID / ගෙවා ඇත";
    case "PARTIALLY_PAID":
      return "PARTIAL / කොටසක් ගෙවා ඇත";
    case "UNPAID":
      return "UNPAID / නොගෙවූ";
    case "CANCELLED":
      return "CANCELLED / අවලංගුයි";
    case "REFUND_DUE":
      return "REFUND DUE";
    default:
      return status;
  }
}

export function InvoicePrintThermal80({ invoice }: InvoicePrintThermal80Props) {
  const hasTransport = invoice.hasTransport && Number(invoice.transportFee) > 0;

  return (
    <section
      aria-label={`Printable 80mm Thermal Receipt ${invoice.invoiceNumber}`}
      className="print-only-sheet print-thermal-sheet bg-white text-black"
    >
      <div
        className="thermal-receipt-container mx-auto w-[72mm] max-w-[72mm] bg-white p-1 text-[11px] leading-tight text-black"
        style={{
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Sinhala', 'Iskoola Pota', monospace",
        }}
      >
        {/* Header / Workshop Identification */}
        <header className="pb-1 text-center">
          <h1 className="text-sm font-extrabold uppercase tracking-wide">
            NPR METAL CRUSHER
          </h1>
          <p className="text-[9px] font-medium text-black/90">
            Seenimodara, Sri Lanka
          </p>
          <p className="text-[9px] font-bold text-black/90">
            Proprietor: Nalaka Ranasinghe
          </p>
        </header>

        <div className="my-1 border-b border-dashed border-black" />

        {/* Receipt / Invoice Meta */}
        <div className="space-y-0.5 text-[10px]">
          <div className="flex justify-between">
            <span className="font-bold">INVOICE / බිල්පත:</span>
            <strong className="text-xs font-extrabold">{invoice.invoiceNumber}</strong>
          </div>
          <div className="flex justify-between">
            <span>Date / දිනය:</span>
            <span>{formatColomboDateTime(invoice.issuedAt)}</span>
          </div>
          <div className="flex justify-between">
            <span>Cashier / අයකැමි:</span>
            <span>{invoice.issuedByName}</span>
          </div>
        </div>

        <div className="my-1 border-b border-dashed border-black" />

        {/* Customer Information (When Available) */}
        <div className="space-y-0.5 text-[10px]">
          <div>
            <span className="font-bold">Customer: </span>
            <span className="font-bold">{invoice.customerName}</span>
          </div>
          {invoice.customerPhone && (
            <div>
              <span>Tel: </span>
              <span>{invoice.customerPhone}</span>
            </div>
          )}
          {invoice.customerLocation && (
            <div>
              <span>Site: </span>
              <span>{invoice.customerLocation}</span>
            </div>
          )}
          <div>
            <span>Delivery: </span>
            <span>
              {invoice.hasTransport
                ? `With Transport (${formatLkr(invoice.transportFee)})`
                : "Customer Pickup (රහිතයි)"}
            </span>
          </div>
        </div>

        <div className="my-1 border-b border-black" />

        {/* Table Column Headers */}
        <div className="flex justify-between pb-0.5 text-[9px] font-bold uppercase">
          <span>Item / Qty (m³) / Rate</span>
          <span className="text-right">Total (LKR)</span>
        </div>

        <div className="border-b border-black" />

        {/* Material Line Items */}
        <div className="divide-y divide-dashed divide-black/30">
          {invoice.items.map((item, idx) => (
            <div key={item.id} className="py-1">
              <div className="flex justify-between gap-1 text-[11px] font-bold">
                <span className="break-words">
                  {idx + 1}. {item.materialName}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {formatLkr(item.lineTotal).replace("Rs. ", "")}
                </span>
              </div>
              <div className="pl-3 text-[10px] text-black/80">
                {item.quantity} m³ @ Rs. {formatLkr(item.unitPrice).replace("Rs. ", "")}
              </div>
            </div>
          ))}
        </div>

        <div className="my-1 border-b border-black" />

        {/* Financial Summary */}
        <div className="space-y-1 text-[11px]">
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span className="tabular-nums font-semibold">{formatLkr(invoice.subtotal)}</span>
          </div>

          {hasTransport && (
            <div className="flex justify-between">
              <span>Transport Fee:</span>
              <span className="tabular-nums font-semibold">{formatLkr(invoice.transportFee)}</span>
            </div>
          )}

          <div className="my-1 flex justify-between border-y border-black py-1 text-xs font-black">
            <span>GRAND TOTAL:</span>
            <span className="tabular-nums">{formatLkr(invoice.grandTotal)}</span>
          </div>

          <div className="flex justify-between">
            <span>Paid Amount / ගෙවූ:</span>
            <span className="tabular-nums font-bold">{formatLkr(invoice.paidAmount)}</span>
          </div>

          <div className="flex justify-between border-t border-dashed border-black/50 pt-0.5 font-black">
            <span>BALANCE DUE / ඉතිරි:</span>
            <span className="tabular-nums">{formatLkr(invoice.balanceDue)}</span>
          </div>

          <div className="flex justify-between pt-0.5 text-[9px] text-black/80">
            <span>Status:</span>
            <span className="font-extrabold uppercase">{formatStatus(invoice.paymentStatus)}</span>
          </div>
        </div>

        {/* Payment Receipts Breakdown (if any payments recorded) */}
        {invoice.payments && invoice.payments.length > 0 && (
          <div className="mt-2 border-t border-dashed border-black pt-1 text-[9px]">
            <p className="font-bold uppercase text-black/80">
              Payments Received ({invoice.payments.length}):
            </p>
            <div className="mt-0.5 space-y-0.5">
              {invoice.payments.map((p) => (
                <div key={p.id} className="flex justify-between tabular-nums">
                  <span>
                    {p.receiptNumber} ({p.paymentMethod})
                  </span>
                  <span className="font-semibold">{formatLkr(p.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="my-2 border-b border-dashed border-black" />

        {/* Footer / Thank You Notice */}
        <footer className="space-y-1 pt-0.5 text-center text-[9px]">
          <p className="text-[10px] font-bold">
            Thank you for your business!
          </p>
          <p className="text-[9px]">
            ඔබගේ සහයෝගයට ස්තූතියි!
          </p>
          <p className="text-[8px] text-black/70">
            Official computer-generated receipt.<br />
            Commercial terms &amp; prices locked upon issuance.
          </p>
          <p className="pt-1 font-mono text-[8px] tracking-widest text-black/60">
            *** END OF RECEIPT ***
          </p>
        </footer>
      </div>
    </section>
  );
}
