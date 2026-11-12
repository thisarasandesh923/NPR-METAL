export interface RecordPaymentInput {
  invoiceId: number;
  amount: string | number;
  idempotencyKey: string;
  notes?: string | null;
}

export interface AdjustPaymentInput {
  paymentId: number;
  adjustmentType: "ENTRY_REVERSAL";
  amount: string | number;
  reason: string;
  idempotencyKey: string;
}

export interface CreatedPaymentRow {
  id: string | number;
  receipt_number: string;
  created_at: Date;
}

export interface InvoicePaymentBounds {
  id: number;
  invoiceNumber: string;
  status: string;
  grandTotal: string;
  creditedAmount: string;
  grossPaidAmount: string;
  adjustedAmount: string;
}

export interface LockedPaymentAdjustmentBounds {
  paymentId: number;
  receiptNumber: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceStatus: string;
  originalAmount: string;
  priorAdjustedAmount: string;
}
