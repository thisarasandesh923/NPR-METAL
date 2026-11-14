import { useLanguage } from "../../../i18n/LanguageContext.tsx";
import { formatLkr } from "../../../utils/formatters.ts";
import type { PaymentStatus } from "../../../types/invoice.ts";

interface PaymentDetailsSectionProps {
  cashReceived: string;
  onChangeCashReceived: (amount: string) => void;
  paymentStatus: PaymentStatus;
  balance: number;
  paidAmount: number;
  grandTotal: number;
  isOverpayment: boolean;
  overpaymentAmount: number;
  disabled?: boolean;
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
  disabled = false,
}: PaymentDetailsSectionProps) {
  const { t } = useLanguage();

  const getStatusLabel = (): string => {
    if (isOverpayment) return "OVERPAYMENT";
    if (balance === 0 && grandTotal > 0) return t("statusPaid");
    if (paidAmount === 0) return t("statusUnpaid");
    return t("statusPartiallyPaid");
  };

  return (
    <section className="invoice-panel">
      <div className="invoice-panel-heading flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="invoice-step">04</span>
          <div>
            <h2>{t("stepPayment")}</h2>
            <p>{t("stepPaymentSubtitle")}</p>
          </div>
        </div>
        {!disabled && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onChangeCashReceived("0.00")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              {t("creditInvoiceShortcut")}
            </button>
            <button
              type="button"
              onClick={() => onChangeCashReceived(grandTotal.toFixed(2))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-[#124f8c] hover:bg-slate-50"
            >
              {t("fullPaymentShortcut")}
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-2 md:p-6">
        <label>
          <span className="form-label">{t("initialCashReceived")}</span>
          <div className="relative">
            <input
              name="initialPaymentAmount"
              disabled={disabled}
              className={`form-control pl-12 text-base font-extrabold ${
                isOverpayment
                  ? "border-rose-400 bg-rose-50/40 text-rose-900 focus:border-rose-500 focus:ring-rose-200"
                  : ""
              }`}
              type="text"
              inputMode="decimal"
              value={cashReceived}
              onChange={(event) => onChangeCashReceived(event.target.value)}
              placeholder="0.00"
            />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
              Rs.
            </span>
          </div>
        </label>

        <div>
          <span className="form-label">{t("status")}</span>
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
            {getStatusLabel()}
          </div>
        </div>
      </div>

      {isOverpayment && (
        <div className="mx-5 mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 md:mx-6 md:mb-6">
          <p className="font-extrabold text-rose-900">
            Overpayment Not Permitted
          </p>
          <p className="mt-1 leading-relaxed text-rose-700">
            Entered cash exceeds the invoice grand total (
            <strong>{formatLkr(grandTotal)}</strong>) by{" "}
            <strong>{formatLkr(overpaymentAmount)}</strong>. Reduce the payment to
            Rs. {grandTotal.toFixed(2)} or less before issuing.
          </p>
        </div>
      )}
    </section>
  );
}
