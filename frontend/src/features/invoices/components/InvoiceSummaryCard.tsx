import { Icon } from "../../../components/ui/Icon.tsx";
import { formatLkr } from "../../../utils/formatters.ts";

interface InvoiceSummaryCardProps {
  subtotal: number;
  withTransport: boolean;
  transportFee: number;
  grandTotal: number;
  paidAmount: number;
  balance: number;
  isSubmitting: boolean;
  canSubmit: boolean;
  onSaveInvoice: () => void;
  onCancel: () => void;
}

export function InvoiceSummaryCard({
  subtotal,
  withTransport,
  transportFee,
  grandTotal,
  paidAmount,
  balance,
  isSubmitting,
  canSubmit,
  onSaveInvoice,
  onCancel,
}: InvoiceSummaryCardProps) {
  return (
    <aside className="h-fit overflow-hidden rounded-2xl bg-[#092547] text-white shadow-[0_14px_35px_rgba(9,37,71,.16)]">
      <div className="border-b border-white/10 px-6 py-5">
        <p className="text-base font-extrabold">Invoice Summary</p>
        <p className="mt-1 text-[11px] text-blue-200/70">
          Authoritative invoice number &amp; totals assigned on save
        </p>
      </div>
      <div className="space-y-4 p-6 text-sm">
        <div className="flex justify-between gap-4 text-blue-100/75">
          <span>Subtotal (Preview)</span>
          <strong className="text-white">{formatLkr(subtotal)}</strong>
        </div>
        <div className="flex justify-between gap-4 text-blue-100/75">
          <span>Transport Fee</span>
          <strong className="text-white">
            {formatLkr(withTransport ? transportFee : 0)}
          </strong>
        </div>
        <div className="border-t border-dashed border-white/20 pt-5">
          <div className="flex items-end justify-between gap-4">
            <span className="font-bold">Grand Total</span>
            <strong className="text-xl font-extrabold text-[#ff9b43]">
              {formatLkr(grandTotal)}
            </strong>
          </div>
        </div>
        <div className="flex justify-between gap-4 text-blue-100/75">
          <span>Initial Cash Paid</span>
          <strong className="text-emerald-300">{formatLkr(paidAmount)}</strong>
        </div>
        <div className="rounded-xl bg-white/[0.07] p-4">
          <div className="flex items-end justify-between gap-4">
            <span className="text-xs font-bold text-blue-100/75">Balance Due</span>
            <strong className="text-lg font-extrabold">{formatLkr(balance)}</strong>
          </div>
        </div>

        <div className="space-y-2.5 pt-2">
          <button
            type="button"
            disabled={!canSubmit || isSubmitting}
            onClick={onSaveInvoice}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#f58220] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#e77418] disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Icon name="check" className="h-4 w-4" />
            {isSubmitting ? "Saving Invoice..." : "Issue & Save Invoice"}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="flex min-h-10 w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-bold text-blue-100 transition hover:bg-white/10"
          >
            Cancel
          </button>
        </div>

        <p className="flex gap-2 pt-1 text-[10px] leading-5 text-blue-200/60">
          <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Once issued to PostgreSQL, line items and prices are permanently locked and A5 printing becomes available.
        </p>
      </div>
    </aside>
  );
}
