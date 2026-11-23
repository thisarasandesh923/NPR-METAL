import type { InvoiceDetail } from "../../../types/billing.ts";
import { formatLkr } from "../../../utils/formatters.ts";

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
      return "REFUND DUE / මුදල් ආපසු";
    default:
      return status;
  }
}

function formatReceiptDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  try {
    return new Intl.DateTimeFormat("en-LK", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatReceiptTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-LK", {
      timeZone: "Asia/Colombo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return "";
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
        className="thermal-receipt-container mx-auto w-[72mm] max-w-[72mm] bg-white p-1 text-[16px] font-normal leading-snug text-black"
        style={{
          fontFamily:
            '"Noto Sans Sinhala", "Iskoola Pota", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif',
        }}
      >
        {/* 1. Workshop Details at the Top */}
        <header className="pb-2 text-center">
          <h1 className="text-[20px] font-semibold uppercase tracking-wider text-black">
            N. P. R. METAL CRUSHER
          </h1>
          <p className="mt-0.5 text-[15px] font-normal text-black">
            Seenimodara
          </p>
          <div className="mt-1 text-[14px] font-normal leading-tight text-black">
            <p>071 4470495 · 077 6159861</p>
            <p>047 3129921</p>
          </div>
          <p className="mt-0.5 text-[14px] font-normal text-black">
            Reg No: H/6/3134
          </p>
        </header>

        <div className="my-2 border-b border-dashed border-black/70" />

        {/* 2. Customer Section */}
        <div className="space-y-1 text-[16px] font-normal leading-snug">
          <div>
            <span className="text-black/80">Customer / පාරිභෝගිකයා: </span>
            <span className="break-words font-medium text-black">{invoice.customerName}</span>
          </div>
          {invoice.customerLocation && (
            <div>
              <span className="text-black/80">Location / ස්ථානය: </span>
              <span className="break-words text-black">{invoice.customerLocation}</span>
            </div>
          )}
          {invoice.customerPhone && (
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-black/80">T.P / දුරකථන:</span>
              <span className="break-words text-black">{invoice.customerPhone}</span>
            </div>
          )}
        </div>

        <div className="my-2 border-b border-dashed border-black/70" />

        {/* 3. Date and Time Section */}
        <div className="space-y-1 text-[15px] font-normal leading-snug">
          <div className="flex items-baseline justify-between gap-1">
            <span className="text-black/80">Invoice / බිල්පත:</span>
            <span className="font-medium text-black">{invoice.invoiceNumber}</span>
          </div>
          <div className="flex items-baseline justify-between gap-1">
            <span className="text-black/80">Date / දිනය:</span>
            <span className="text-black">{formatReceiptDate(invoice.issuedAt)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-1">
            <span className="text-black/80">Time / වේලාව:</span>
            <span className="text-black">{formatReceiptTime(invoice.issuedAt)}</span>
          </div>
        </div>

        <div className="my-2 border-b border-black" />

        {/* 4. Material Section */}
        <div className="divide-y divide-dashed divide-black/40">
          {invoice.items.map((item, idx) => {
            const itemUnit = item.unitSnapshot || invoice.unitSnapshot || "m³";
            const unitPriceNum = formatLkr(item.unitPrice).replace("Rs. ", "");
            const lineTotalFormatted = formatLkr(item.lineTotal);

            return (
              <div key={item.id} className="py-2 text-[16px] font-normal leading-snug">
                {/* Material Name */}
                <div className="break-words font-medium text-black">
                  {idx + 1}. {item.materialName}
                </div>
                {/* Price per ft³ / unit, Quantity, and Line Total */}
                <div className="mt-0.5 flex items-baseline justify-between gap-1 tabular-nums">
                  <span className="text-black">
                    {item.quantity} {itemUnit} × Rs. {unitPriceNum}
                  </span>
                  <span className="font-medium text-black">
                    {lineTotalFormatted}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 5. Transport Section (shown when transport fee applies) */}
        {hasTransport && (
          <>
            <div className="my-2 border-b border-dashed border-black/70" />
            <div className="flex items-baseline justify-between gap-1 text-[16px] font-normal tabular-nums leading-snug">
              <span className="text-black/80">Transport / ප්‍රවාහන:</span>
              <span className="font-medium text-black">{formatLkr(invoice.transportFee)}</span>
            </div>
          </>
        )}

        <div className="my-2 border-b border-black" />

        {/* 6. Payment Summary */}
        <div className="space-y-1.5 text-[16px] font-normal leading-snug">
          {/* Total */}
          <div className="flex items-baseline justify-between gap-1 border-b border-black pb-1.5 text-[18px] font-semibold tabular-nums text-black">
            <span>Total / එකතුව:</span>
            <span>{formatLkr(invoice.grandTotal)}</span>
          </div>

          {/* Paid Amount */}
          <div className="flex items-baseline justify-between gap-1 pt-0.5 tabular-nums">
            <span className="text-black/80">Paid / ගෙවූ මුදල:</span>
            <span className="font-medium text-black">{formatLkr(invoice.paidAmount)}</span>
          </div>

          {/* Balance Due (when outstanding balance remains) */}
          {Number(invoice.balanceDue) > 0 && (
            <div className="flex items-baseline justify-between gap-1 tabular-nums text-[17px] font-semibold text-black">
              <span>Balance / ඉතිරිය:</span>
              <span>{formatLkr(invoice.balanceDue)}</span>
            </div>
          )}

          {/* Payment Status */}
          <div className="flex items-baseline justify-between gap-1 pt-1 text-[15px] font-normal text-black/90">
            <span className="text-black/80">Status / තත්ත්වය:</span>
            <span className="font-medium uppercase">{formatStatus(invoice.paymentStatus)}</span>
          </div>
        </div>

        <div className="my-3 border-b border-dashed border-black/70" />

        {/* 7. Footer */}
        <footer className="space-y-0.5 text-center text-[15px] font-normal text-black">
          <p className="font-medium">Thank You!</p>
          <p>ස්තූතියි!</p>
        </footer>
      </div>
    </section>
  );
}
