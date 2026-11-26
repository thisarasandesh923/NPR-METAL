
import { useState, type FormEvent } from "react";
import { recordCashPaymentRequest } from "../../../api/billing.ts";
import { ApiError } from "../../../api/client.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import { useLanguage } from "../../../i18n/LanguageContext.tsx";
import type { InvoiceDetail } from "../../../types/billing.ts";
import { formatLkr } from "../../../utils/formatters.ts";

interface RecordPaymentModalProps {
  invoice: InvoiceDetail;
  onClose: () => void;
  onSuccess: (
    updatedInvoice: InvoiceDetail,
    receiptNumber: string
  ) => void;
}

const MAX_CASH_CENTS = 999_999_999_999n;

function generateUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `pay-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 14)}`;
}

// Convert LKR values to integer cents.
// This avoids floating-point errors in cash calculations.
function parseLkrCents(value: string): bigint | null {
  const trimmed = value.trim();

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);

  if (!match) {
    return null;
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt(
    (match[2] ?? "").padEnd(2, "0")
  );

  return whole * 100n + fraction;
}

export function RecordPaymentModal({
  invoice,
  onClose,
  onSuccess,
}: RecordPaymentModalProps) {
  const { t } = useLanguage();

  const [amount, setAmount] = useState(invoice.balanceDue);

  const [cashTendered, setCashTendered] = useState(
    invoice.balanceDue
  );

  const [notes, setNotes] = useState("");

  const [idempotencyKey, setIdempotencyKey] = useState(
    () => generateUuid()
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Payment amount changes reset the default cash tendered.
  const handleAmountChange = (val: string) => {
    setAmount(val);
    setCashTendered(val);
    setIdempotencyKey(generateUuid());
    setError(null);
  };

  // Cash tendered can be changed independently.
  const handleCashTenderedChange = (val: string) => {
    setCashTendered(val);
    setIdempotencyKey(generateUuid());
    setError(null);
  };

  // Calculate the change for display.
  const paymentCents = parseLkrCents(amount);
  const tenderedCents = parseLkrCents(cashTendered);
  const balanceCents = parseLkrCents(invoice.balanceDue);

  const canCalculateChange =
    paymentCents !== null &&
    tenderedCents !== null &&
    paymentCents > 0n &&
    paymentCents <= MAX_CASH_CENTS &&
    tenderedCents <= MAX_CASH_CENTS &&
    tenderedCents >= paymentCents &&
    balanceCents !== null &&
    paymentCents <= balanceCents;

  const changeCents = canCalculateChange
    ? tenderedCents! - paymentCents!
    : null;

  // Record the payment with cash details.
  const handleSubmit = async (
    e: FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (submitting) {
      return;
    }

    const trimmedAmount = amount.trim();
    const trimmedCash = cashTendered.trim();

    const enteredPaymentCents = parseLkrCents(trimmedAmount);
    const enteredCashCents = parseLkrCents(trimmedCash);
    const remainingCents = parseLkrCents(invoice.balanceDue);

    // Validate the actual payment amount.
    if (
      enteredPaymentCents === null ||
      enteredPaymentCents <= 0n ||
      enteredPaymentCents > MAX_CASH_CENTS
    ) {
      setError(
        "Enter a valid positive payment amount in LKR (up to 2 decimals)."
      );
      return;
    }

    // Prevent recording more than the outstanding balance.
    if (
      remainingCents === null ||
      enteredPaymentCents > remainingCents
    ) {
      setError(
        "Payment amount cannot exceed the remaining invoice balance."
      );
      return;
    }

    // Validate the physical cash received.
    if (
      enteredCashCents === null ||
      enteredCashCents > MAX_CASH_CENTS
    ) {
      setError(
        "Enter a valid Cash Tendered amount in LKR (up to 2 decimals)."
      );
      return;
    }

    if (enteredCashCents < enteredPaymentCents) {
      setError(
        "Cash Tendered cannot be less than the Payment Amount."
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await recordCashPaymentRequest({
        invoiceId: invoice.id,
        amount: trimmedAmount,
        cashTendered: trimmedCash,
        idempotencyKey,
        notes: notes.trim() || null,
      });

      onSuccess(
        result.invoice,
        result.payment.receiptNumber
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(
          "Failed to record cash payment. Please try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-payment-title"
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-[#071b35]/60 p-4 backdrop-blur-sm"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">

        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#f58220]">
              {t("recordCashPaymentTitle")}
            </p>

            <h2
              id="record-payment-title"
              className="mt-1 text-lg font-extrabold text-[#092547]"
            >
              {t("recordPaymentSubtitle")} ·{" "}
              {invoice.invoiceNumber}
            </h2>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Close payment modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        {/* Invoice Information */}
        <div className="mt-4 rounded-xl bg-[#f8fafc] p-3.5 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">
              {t("customer")}:
            </span>

            <strong className="text-right text-[#092547]">
              {invoice.customerName}
            </strong>
          </div>

          <div className="mt-2 flex justify-between gap-3">
            <span className="text-slate-500">
              {t("balanceDue")}:
            </span>

            <strong className="text-sm text-[#e77418]">
              {formatLkr(invoice.balanceDue)}
            </strong>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700"
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="mt-4 space-y-4"
        >
          {/* Actual Payment Amount */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="payment-amount-input"
                className="text-xs font-bold uppercase tracking-[0.06em] text-slate-600"
              >
                {t("paymentAmountLkr")} *
              </label>

              <button
                type="button"
                disabled={submitting}
                onClick={() =>
                  handleAmountChange(invoice.balanceDue)
                }
                className="text-xs font-bold text-[#124f8c] hover:underline"
              >
                {t("payFullBalanceBtn")}
              </button>
            </div>

            <input
              id="payment-amount-input"
              type="text"
              inputMode="decimal"
              disabled={submitting}
              value={amount}
              onChange={(e) =>
                handleAmountChange(e.target.value)
              }
              className="form-control text-base font-extrabold"
              placeholder="0.00"
              required
            />

            <p className="mt-1 text-xs text-slate-500">
              Amount recorded against the invoice.
            </p>
          </div>

          {/* Cash Tendered Input */}
          <div>
            <label
              htmlFor="cash-tendered-input"
              className="mb-1.5 block text-xs font-bold uppercase tracking-[0.06em] text-slate-600"
            >
              Cash Tendered (Rs.) *
            </label>

            <input
              id="cash-tendered-input"
              type="text"
              inputMode="decimal"
              disabled={submitting}
              value={cashTendered}
              onChange={(e) =>
                handleCashTenderedChange(e.target.value)
              }
              className="form-control text-base font-extrabold"
              placeholder="0.00"
              required
            />

            <p className="mt-1 text-xs text-slate-500">
              Total cash physically received from the customer.
            </p>
          </div>

          {/* Change Returned Preview */}
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-extrabold text-emerald-800">
                  Change Returned
                </p>

                <p className="mt-1 text-xs text-emerald-700">
                  Cash Tendered − Payment Amount
                </p>
              </div>

              <strong className="text-xl font-extrabold text-emerald-700">
                {changeCents === null
                  ? "—"
                  : formatLkr(Number(changeCents) / 100)}
              </strong>
            </div>
          </div>

          {/* Optional Notes */}
          <div>
            <label
              htmlFor="payment-notes-input"
              className="mb-1.5 block text-xs font-bold uppercase tracking-[0.06em] text-slate-600"
            >
              {t("receiptNumberOptional")}
            </label>

            <input
              id="payment-notes-input"
              type="text"
              maxLength={500}
              disabled={submitting}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setIdempotencyKey(generateUuid());
                setError(null);
              }}
              className="form-control"
              placeholder="e.g. Receipt #12345"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              {t("cancel")}
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-[#f58220] px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#e77418] disabled:opacity-60"
            >
              {submitting
                ? t("saving")
                : t("confirmPaymentBtn")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
