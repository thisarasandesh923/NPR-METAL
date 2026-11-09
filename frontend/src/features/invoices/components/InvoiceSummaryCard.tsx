import { Icon } from "../../../components/ui/Icon";
import { formatLkr } from "../../../utils/formatters";

interface InvoiceSummaryCardProps {
  subtotal: number;
  withTransport: boolean;
  transportFee: number;
  grandTotal: number;
  paidAmount: number;
  balance: number;
}

export function InvoiceSummaryCard({
  subtotal,
  withTransport,
  transportFee,
  grandTotal,
  paidAmount,
  balance,
}: InvoiceSummaryCardProps) {
  return (
    <aside className="h-fit overflow-hidden rounded-2xl bg-[#092547] text-white shadow-[0_14px_35px_rgba(9,37,71,.16)]">
      <div className="border-b border-white/10 px-6 py-5">
        <p className="text-base font-extrabold">Invoice Summary</p>
        <p className="mt-1 text-[11px] text-blue-200/60">INV-1049 · May 24, 2025</p>
      </div>
      <div className="space-y-4 p-6 text-sm">
        <div className="flex justify-between gap-4 text-blue-100/70">
          <span>Subtotal</span>
          <strong className="text-white">{formatLkr(subtotal)}</strong>
        </div>
        <div className="flex justify-between gap-4 text-blue-100/70">
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
        <div className="flex justify-between gap-4 text-blue-100/70">
          <span>Paid Amount</span>
          <strong className="text-emerald-300">{formatLkr(paidAmount)}</strong>
        </div>
        <div className="rounded-xl bg-white/[0.07] p-4">
          <div className="flex items-end justify-between gap-4">
            <span className="text-xs font-bold text-blue-100/70">Balance Due</span>
            <strong className="text-lg font-extrabold">{formatLkr(balance)}</strong>
          </div>
        </div>
        <p className="flex gap-2 pt-1 text-[10px] leading-5 text-blue-200/55">
          <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Once issued, this invoice cannot be modified by cashiers.
        </p>
      </div>
    </aside>
  );
}
