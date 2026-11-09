import { Icon } from "../../../components/ui/Icon";
import { formatLkr } from "../../../utils/formatters";
import type { PaymentStatus } from "../../../types/invoice";

interface PaymentDetailsSectionProps {
  cashReceived: number;
  onChangeCashReceived: (amount: number) => void;
  paymentStatus: PaymentStatus;
  balance: number;
  paidAmount: number;
  grandTotal: number;
  isOverpayment: boolean;
  overpaymentAmount: number;
}

export function PaymentDetailsSection({
  cashReceived,
  onChangeCashReceived,
  paymentStatus,
  balance,
  paidAmount,
  grandTotal,
  isOverpayment,
  overpaymentAmount,
}: PaymentDetailsSectionProps) {
  return (
    <section className="invoice-panel">
      <div className="invoice-panel-heading">
        <span className="invoice-step">04</span>
        <div>
          <h2>Cash Payment</h2>
          <p>Payment status is calculated based on cash received</p>
        </div>
      </div>
      <div className="grid gap-5 p-5 md:grid-cols-2 md:p-6">
        <label>
          <span className="form-label">Cash Received (LKR)</span>
          <div className="relative">
            <input
              className={`form-control pl-12 text-base font-extrabold ${
                isOverpayment
                  ? "border-rose-400 bg-rose-50/40 text-rose-900 focus:border-rose-500 focus:ring-rose-200"
                  : ""
              }`}
              type="number"
              min="0"
              value={cashReceived}
              onChange={(event) => onChangeCashReceived(Number(event.target.value))}
            />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
              Rs.
            </span>
          </div>
        </label>
        <div>
          <span className="form-label">Payment Status</span>
          <div
            className={`payment-state ${
              isOverpayment
                ? "border border-rose-300 bg-rose-50 text-rose-700"
                : balance === 0
                  ? "payment-state-paid"
                  : paidAmount === 0
                    ? "payment-state-unpaid"
                    : "payment-state-partial"
            }`}
          >
            <span className={isOverpayment ? "bg-rose-500" : ""} />
            {paymentStatus}
          </div>
        </div>
      </div>

      {isOverpayment && (
        <div className="mx-5 mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 md:mx-6 md:mb-6">
          <div className="flex items-start gap-2.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-200 text-rose-800 font-bold">
              !
            </div>
            <div>
              <p className="font-extrabold text-rose-900">
                Excess Cash Warning: Overpayment Detected
              </p>
              <p className="mt-1 leading-relaxed text-rose-700">
                Entered cash of <strong>{formatLkr(cashReceived)}</strong> exceeds the invoice total (
                <strong>{formatLkr(grandTotal)}</strong>) by <strong>{formatLkr(overpaymentAmount)}</strong>.
                Cash payments cannot exceed the invoice total and cannot be recorded as a valid payment.
                Please enter the exact cash received or an amount up to the grand total.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
