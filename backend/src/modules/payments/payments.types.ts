export interface RecordPaymentInput {
  invoiceId: number;
  amount: string | number;
  idempotencyKey: string;
  notes?: string | null;
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
