
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
  balance,
  paidAmount,
  grandTotal,
  isOverpayment,
  overpaymentAmount,
  disabled = false,
}: PaymentDetailsSectionProps) {
  const { t } = useLanguage();

  const getStatusLabel = (): string => {
    if (balance === 0 && grandTotal > 0) {
      return t("statusPaid");
    }

    if (paidAmount === 0) {
      return t("statusUnpaid");
    }

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
              onClick={() =>
                onChangeCashReceived(grandTotal.toFixed(2))
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-[#124f8c] hover:bg-slate-50"
            >
              {t("fullPaymentShortcut")}
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-2 md:p-6">
        <label>
          <span className="form-label">
            {t("initialCashReceived")}
          </span>

          <div className="relative">
            <input
              name="initialCashTendered"
              disabled={disabled}
              className="form-control pl-12 text-base font-extrabold"
              type="text"
              inputMode="decimal"
              value={cashReceived}
              onChange={(event) =>
                onChangeCashReceived(event.target.value)
              }
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
              balance === 0 && grandTotal > 0
                ? "payment-state-paid"
                : paidAmount === 0
                  ? "payment-state-unpaid"
                  : "payment-state-partial"
            }`}
          >
            <span />
            {getStatusLabel()}
          </div>
        </div>
      </div>

      <div className="mx-5 mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4 md:mx-6 md:mb-6">
        <div className="flex justify-between gap-4 text-sm">
          <span>Payment Recorded</span>
          <strong>{formatLkr(paidAmount)}</strong>
        </div>

        <div className="mt-2 flex justify-between gap-4 text-sm">
          <span>Balance Due</span>
          <strong>{formatLkr(balance)}</strong>
        </div>

        {isOverpayment && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 flex items-center justify-between gap-4 border-t border-emerald-200 pt-4 text-emerald-700"
          >
            <strong>Change Returned</strong>
            <strong className="text-lg">
              {formatLkr(overpaymentAmount)}
            </strong>
          </div>
        )}
      </div>
    </section>
  );
}
