import type { PoolClient } from "pg";
import type {
  CreatedPaymentRow,
  InvoicePaymentBounds,
} from "./payments.types.js";

export async function lockInvoicePaymentBounds(
  client: PoolClient,
  invoiceId: number
): Promise<InvoicePaymentBounds | null> {
  const invRes = await client.query<{
    id: string | number;
    invoice_number: string;
    status: string;
    grand_total: string;
  }>(
    `SELECT id, invoice_number, status, grand_total::text AS grand_total
     FROM public.invoices
     WHERE id = $1
     FOR UPDATE`,
    [invoiceId]
  );

  const inv = invRes.rows[0];
  if (!inv) {
    return null;
  }

  const credRes = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(credit_amount), 0.00)::NUMERIC(12, 2)::text AS total
     FROM public.credit_notes
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  const paidRes = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2)::text AS total
     FROM public.payments
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  const adjRes = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(pa.adjustment_amount), 0.00)::NUMERIC(12, 2)::text AS total
     FROM public.payment_adjustments pa
     JOIN public.payments py ON py.id = pa.payment_id
     WHERE py.invoice_id = $1`,
    [invoiceId]
  );

  return {
    id: Number(inv.id),
    invoiceNumber: inv.invoice_number,
    status: inv.status,
    grandTotal: inv.grand_total,
    creditedAmount: credRes.rows[0].total,
    grossPaidAmount: paidRes.rows[0].total,
    adjustedAmount: adjRes.rows[0].total,
  };
}

export async function insertCashPayment(
  client: PoolClient,
  params: {
    invoiceId: number;
    cashierUserId: string;
    amount: string;
    idempotencyKey: string;
    notes: string | null;
  }
): Promise<CreatedPaymentRow> {
  const res = await client.query<CreatedPaymentRow>(
    `INSERT INTO public.payments (
       invoice_id,
       cashier_user_id,
       amount,
       payment_method,
       idempotency_key,
       notes
     ) VALUES ($1, $2, $3, 'CASH', $4, $5)
     RETURNING id, receipt_number, created_at`,
    [
      params.invoiceId,
      params.cashierUserId,
      params.amount,
      params.idempotencyKey,
      params.notes,
    ]
  );
  return res.rows[0];
}
