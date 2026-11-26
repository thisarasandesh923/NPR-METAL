import type { PoolClient } from "pg";
import type {
  CreatedPaymentRow,
  InvoicePaymentBounds,
  LockedPaymentAdjustmentBounds,
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
    cashTendered?: string | null;
    changeReturned?: string | null;
  }
): Promise<CreatedPaymentRow> {
  const res = await client.query<CreatedPaymentRow>(
    `INSERT INTO public.payments (
       invoice_id,
       cashier_user_id,
       amount,
       payment_method,
       idempotency_key,
       notes,
       cash_tendered,
       change_returned
     ) VALUES ($1, $2, $3, 'CASH', $4, $5, $6, $7)
     RETURNING id, receipt_number, created_at`,
    [
      params.invoiceId,
      params.cashierUserId,
      params.amount,
      params.idempotencyKey,
      params.notes,
      params.cashTendered ?? null,
      params.changeReturned ?? null,
    ]
  );

  return res.rows[0];
}


export async function lockPaymentForAdjustment(
  client: PoolClient,
  paymentId: number
): Promise<LockedPaymentAdjustmentBounds | null> {
  const payRes = await client.query<{
    id: string | number;
    receipt_number: string;
    invoice_id: string | number;
    invoice_number: string;
    invoice_status: string;
    amount: string;
  }>(
    `SELECT
       p.id,
       p.receipt_number,
       p.invoice_id,
       i.invoice_number,
       i.status AS invoice_status,
       p.amount::text AS amount
     FROM public.payments p
     JOIN public.invoices i ON i.id = p.invoice_id
     WHERE p.id = $1
     FOR UPDATE OF i`,
    [paymentId]
  );

  const row = payRes.rows[0];
  if (!row) {
    return null;
  }

  const adjRes = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(adjustment_amount), 0.00)::NUMERIC(12, 2)::text AS total
     FROM public.payment_adjustments
     WHERE payment_id = $1`,
    [paymentId]
  );

  return {
    paymentId: Number(row.id),
    receiptNumber: row.receipt_number,
    invoiceId: Number(row.invoice_id),
    invoiceNumber: row.invoice_number,
    invoiceStatus: row.invoice_status,
    originalAmount: row.amount,
    priorAdjustedAmount: adjRes.rows[0].total,
  };
}

export async function insertPaymentAdjustment(
  client: PoolClient,
  params: {
    paymentId: number;
    ownerUserId: string;
    adjustmentType: "ENTRY_REVERSAL";
    adjustmentAmount: string;
    reason: string;
    idempotencyKey: string;
  }
): Promise<{ id: number; adjustment_number: string; created_at: Date }> {
  const res = await client.query<{
    id: string | number;
    adjustment_number: string;
    created_at: Date;
  }>(
    `INSERT INTO public.payment_adjustments (
       payment_id,
       authorized_by_owner_id,
       performed_by_user_id,
       adjustment_type,
       adjustment_amount,
       idempotency_key,
       reason
     ) VALUES ($1, $2, $2, $3, $4, $5, $6)
     RETURNING id, adjustment_number, created_at`,
    [
      params.paymentId,
      params.ownerUserId,
      params.adjustmentType,
      params.adjustmentAmount,
      params.idempotencyKey,
      params.reason,
    ]
  );
  return {
    id: Number(res.rows[0].id),
    adjustment_number: res.rows[0].adjustment_number,
    created_at: res.rows[0].created_at,
  };
}
