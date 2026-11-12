import { useState, type FormEvent } from "react";
import { recordCashPaymentRequest } from "../../../api/billing.ts";
import { ApiError } from "../../../api/client.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import type { InvoiceDetail } from "../../../types/billing.ts";
import { formatLkr } from "../../../utils/formatters.ts";

interface RecordPaymentModalProps {
  invoice: InvoiceDetail;
  onClose: () => void;
  onSuccess: (updatedInvoice: InvoiceDetail, receiptNumber: string) => void;
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pay-${Date.now()}-${Math.random().toString(16).slice(2, 14)}`;
}

export function RecordPaymentModal({
  invoice,
  onClose,
  onSuccess,
}: RecordPaymentModalProps) {
  const [amount, setAmount] = useState(invoice.balanceDue);
  const [notes, setNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateUuid());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAmountChange = (val: string) => {
    setAmount(val);
    setIdempotencyKey(generateUuid());
    setError(null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) {
      return;
    }

    const trimmed = amount.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed) || Number(trimmed) <= 0) {
      setError("Enter a valid positive payment amount in LKR (up to 2 decimals).");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await recordCashPaymentRequest({
        invoiceId: invoice.id,
        amount: trimmed,
        idempotencyKey,
        notes: notes.trim() || null,
      });
      onSuccess(result.invoice, result.payment.receiptNumber);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to record cash payment. Please try again.");
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
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#f58220]">
              Cash Receipt Entry
            </p>
            <h2
              id="record-payment-title"
              className="mt-1 text-lg font-extrabold text-[#092547]"
            >
              Record Payment · {invoice.invoiceNumber}
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

        <div className="mt-4 rounded-xl bg-[#f8fafc] p-3.5 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">Customer:</span>
            <strong className="text-[#092547]">{invoice.customerName}</strong>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-slate-500">Outstanding Balance:</span>
            <strong className="text-sm text-[#e77418]">
              {formatLkr(invoice.balanceDue)}
            </strong>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="payment-amount-input"
                className="text-xs font-bold uppercase tracking-[0.06em] text-slate-600"
              >
                Cash Received (LKR) *
              </label>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleAmountChange(invoice.balanceDue)}
                className="text-xs font-bold text-[#124f8c] hover:underline"
              >
                Fill Full Balance
              </button>
            </div>
            <input
              id="payment-amount-input"
              type="text"
              inputMode="decimal"
              disabled={submitting}
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="form-control text-base font-extrabold"
              placeholder="0.00"
              required
            />
          </div>

          <div>
            <label
              htmlFor="payment-notes-input"
              className="mb-1.5 block text-xs font-bold uppercase tracking-[0.06em] text-slate-600"
            >
              Notes (Optional)
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
              }}
              className="form-control"
              placeholder="e.g. Second cash installment"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-[#f58220] px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#e77418] disabled:opacity-60"
            >
              {submitting ? "Recording..." : "Save Cash Payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
