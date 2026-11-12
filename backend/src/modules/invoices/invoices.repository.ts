import type { Pool, PoolClient } from "pg";
import type {
  InvoiceDetailDto,
  InvoiceItemDto,
  InvoicePaymentDto,
  InvoiceStatus,
  InvoiceSummaryDto,
  PaymentStatus,
} from "./invoices.types.js";

export type DbClient = Pool | PoolClient;

export interface IdempotencyRecordRow {
  operation_type: string;
  request_hash: string;
  actor_user_id: string;
  response_status: number;
  response_payload: unknown;
  expires_at: Date;
}

interface InvoiceLedgerRow {
  invoice_id: string | number;
  invoice_number: string;
  customer_id: string | number;
  customer_name_snapshot: string;
  customer_phone_snapshot: string;
  customer_location_snapshot: string;
  has_transport: boolean;
  transport_fee: string;
  subtotal: string;
  original_grand_total: string;
  effective_grand_total: string;
  effective_paid: string;
  balance_due: string;
  payment_status: PaymentStatus;
  invoice_status: InvoiceStatus;
  issued_by_user_id: string;
  issued_by_name: string;
  issued_at: Date;
  business_date: Date | string;
}

interface InvoiceItemRow {
  id: string | number;
  material_id: number;
  material_name_snapshot: string;
  quantity: string;
  unit_price: string;
  line_total: string;
}

interface InvoicePaymentRow {
  id: string | number;
  receipt_number: string;
  invoice_id: string | number;
  cashier_user_id: string;
  cashier_name: string;
  amount: string;
  payment_method: "CASH";
  notes: string | null;
  created_at: Date;
}

function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, "\\$&");
}

function formatDateOnly(value: Date | string): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function mapSummaryRow(row: InvoiceLedgerRow): InvoiceSummaryDto {
  return {
    id: Number(row.invoice_id),
    invoiceNumber: row.invoice_number,
    customerId: Number(row.customer_id),
    customerName: row.customer_name_snapshot,
    customerPhone: row.customer_phone_snapshot,
    customerLocation: row.customer_location_snapshot,
    hasTransport: row.has_transport,
    transportFee: row.transport_fee,
    subtotal: row.subtotal,
    grandTotal: row.original_grand_total,
    effectiveGrandTotal: row.effective_grand_total,
    paidAmount: row.effective_paid,
    balanceDue: row.balance_due,
    paymentStatus: row.payment_status,
    invoiceStatus: row.invoice_status,
    issuedByUserId: row.issued_by_user_id,
    issuedByName: row.issued_by_name,
    issuedAt: row.issued_at.toISOString(),
    businessDate: formatDateOnly(row.business_date),
  };
}

export async function acquireIdempotencyLock(
  client: PoolClient,
  lockScope: string,
  idempotencyKey: string
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${lockScope}:${idempotencyKey}`]
  );
}

export async function findIdempotencyRecord(
  client: PoolClient,
  idempotencyKey: string
): Promise<IdempotencyRecordRow | null> {
  const res = await client.query<IdempotencyRecordRow>(
    `SELECT operation_type, request_hash, actor_user_id, response_status, response_payload, expires_at
     FROM public.idempotency_records
     WHERE idempotency_key = $1
     LIMIT 1`,
    [idempotencyKey]
  );
  return res.rows[0] ?? null;
}

export async function deleteExpiredIdempotencyRecord(
  client: PoolClient,
  idempotencyKey: string
): Promise<void> {
  await client.query(
    `DELETE FROM public.idempotency_records
     WHERE idempotency_key = $1 AND expires_at < NOW()`,
    [idempotencyKey]
  );
}

export async function insertIdempotencyRecord(
  client: PoolClient,
  params: {
    idempotencyKey: string;
    operationType:
      | "ISSUE_INVOICE"
      | "RECORD_PAYMENT"
      | "PAYMENT_ADJUSTMENT"
      | "ISSUE_CREDIT_NOTE"
      | "UPDATE_MATERIAL_PRICE"
      | "RECORD_WORKER_ADVANCE"
      | "RECORD_SALARY_PAYMENT"
      | "RECORD_EXPENSE";
    requestHash: string;
    actorUserId: string;
    responseStatus: number;
    responsePayload: unknown;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO public.idempotency_records
       (idempotency_key, operation_type, request_hash, actor_user_id, response_status, response_payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      params.idempotencyKey,
      params.operationType,
      params.requestHash,
      params.actorUserId,
      params.responseStatus,
      JSON.stringify(params.responsePayload),
    ]
  );
}

export async function insertDraftInvoice(
  client: PoolClient,
  params: {
    customerId: number;
    customerNameSnapshot: string;
    customerPhoneSnapshot: string;
    customerLocationSnapshot: string;
    hasTransport: boolean;
    transportFee: string;
    issuedByUserId: string;
  }
): Promise<{ id: number; invoiceNumber: string }> {
  const res = await client.query<{ id: string | number; invoice_number: string }>(
    `INSERT INTO public.invoices (
       customer_id,
       customer_name_snapshot,
       customer_phone_snapshot,
       customer_location_snapshot,
       has_transport,
       transport_fee,
       subtotal,
       grand_total,
       status,
       issued_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, 0.00, $6, 'DRAFT', $7)
     RETURNING id, invoice_number`,
    [
      params.customerId,
      params.customerNameSnapshot,
      params.customerPhoneSnapshot,
      params.customerLocationSnapshot,
      params.hasTransport,
      params.transportFee,
      params.issuedByUserId,
    ]
  );
  return {
    id: Number(res.rows[0].id),
    invoiceNumber: res.rows[0].invoice_number,
  };
}

export async function insertInvoiceItem(
  client: PoolClient,
  params: {
    invoiceId: number;
    materialId: number;
    materialNameSnapshot: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO public.invoice_items (
       invoice_id,
       material_id,
       material_name_snapshot,
       quantity,
       unit_price,
       line_total
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.invoiceId,
      params.materialId,
      params.materialNameSnapshot,
      params.quantity,
      params.unitPrice,
      params.lineTotal,
    ]
  );
}

export async function finalizeDraftInvoice(
  client: PoolClient,
  params: {
    invoiceId: number;
    subtotal: string;
    grandTotal: string;
  }
): Promise<void> {
  await client.query(
    `UPDATE public.invoices
     SET subtotal = $1,
         grand_total = $2,
         status = 'ISSUED',
         issued_at = NOW()
     WHERE id = $3`,
    [params.subtotal, params.grandTotal, params.invoiceId]
  );
}

export async function listIssuedInvoices(
  client: DbClient,
  filters: {
    q?: string;
    paymentStatus?: string;
    limit: number;
  }
): Promise<InvoiceSummaryDto[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.q?.trim()) {
    params.push(`%${escapeLikePattern(filters.q.trim())}%`);
    const idx = params.length;
    conditions.push(
      `(ilv.invoice_number ILIKE $${idx} ESCAPE '\\' OR ilv.customer_name_snapshot ILIKE $${idx} ESCAPE '\\' OR ilv.customer_phone_snapshot ILIKE $${idx} ESCAPE '\\')`
    );
  }

  if (filters.paymentStatus?.trim()) {
    params.push(filters.paymentStatus.trim());
    conditions.push(`ilv.payment_status = $${params.length}`);
  }

  params.push(filters.limit);
  const limitParamIdx = params.length;

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const res = await client.query<InvoiceLedgerRow>(
    `SELECT
       ilv.invoice_id,
       ilv.invoice_number,
       ilv.customer_id,
       ilv.customer_name_snapshot,
       ilv.customer_phone_snapshot,
       ilv.customer_location_snapshot,
       ilv.has_transport,
       ilv.transport_fee::text AS transport_fee,
       ilv.subtotal::text AS subtotal,
       ilv.original_grand_total::text AS original_grand_total,
       ilv.effective_grand_total::text AS effective_grand_total,
       ilv.effective_paid::text AS effective_paid,
       ilv.balance_due::text AS balance_due,
       ilv.payment_status,
       ilv.invoice_status,
       ilv.issued_by_user_id,
       u.full_name AS issued_by_name,
       ilv.issued_at,
       ilv.business_date::text AS business_date
     FROM public.invoice_ledger_view ilv
     JOIN public.users u ON u.id = ilv.issued_by_user_id
     ${whereClause}
     ORDER BY ilv.issued_at DESC, ilv.invoice_id DESC
     LIMIT $${limitParamIdx}`,
    params
  );

  return res.rows.map(mapSummaryRow);
}

export async function findInvoiceDetailById(
  client: DbClient,
  invoiceId: number
): Promise<InvoiceDetailDto | null> {
  const headerRes = await client.query<InvoiceLedgerRow>(
    `SELECT
       ilv.invoice_id,
       ilv.invoice_number,
       ilv.customer_id,
       ilv.customer_name_snapshot,
       ilv.customer_phone_snapshot,
       ilv.customer_location_snapshot,
       ilv.has_transport,
       ilv.transport_fee::text AS transport_fee,
       ilv.subtotal::text AS subtotal,
       ilv.original_grand_total::text AS original_grand_total,
       ilv.effective_grand_total::text AS effective_grand_total,
       ilv.effective_paid::text AS effective_paid,
       ilv.balance_due::text AS balance_due,
       ilv.payment_status,
       ilv.invoice_status,
       ilv.issued_by_user_id,
       u.full_name AS issued_by_name,
       ilv.issued_at,
       ilv.business_date::text AS business_date
     FROM public.invoice_ledger_view ilv
     JOIN public.users u ON u.id = ilv.issued_by_user_id
     WHERE ilv.invoice_id = $1
     LIMIT 1`,
    [invoiceId]
  );

  const header = headerRes.rows[0];
  if (!header) {
    return null;
  }

  const itemsRes = await client.query<InvoiceItemRow>(
    `SELECT
       id,
       material_id,
       material_name_snapshot,
       quantity::text AS quantity,
       unit_price::text AS unit_price,
       line_total::text AS line_total
     FROM public.invoice_items
     WHERE invoice_id = $1
     ORDER BY id ASC`,
    [invoiceId]
  );

  const paymentsRes = await client.query<InvoicePaymentRow>(
    `SELECT
       p.id,
       p.receipt_number,
       p.invoice_id,
       p.cashier_user_id,
       u.full_name AS cashier_name,
       p.amount::text AS amount,
       p.payment_method,
       p.notes,
       p.created_at
     FROM public.payments p
     JOIN public.users u ON u.id = p.cashier_user_id
     WHERE p.invoice_id = $1
     ORDER BY p.created_at ASC, p.id ASC`,
    [invoiceId]
  );

  const items: InvoiceItemDto[] = itemsRes.rows.map((r) => ({
    id: Number(r.id),
    materialId: r.material_id,
    materialName: r.material_name_snapshot,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    lineTotal: r.line_total,
  }));

  const payments: InvoicePaymentDto[] = paymentsRes.rows.map((p) => ({
    id: Number(p.id),
    receiptNumber: p.receipt_number,
    invoiceId: Number(p.invoice_id),
    cashierUserId: p.cashier_user_id,
    cashierName: p.cashier_name,
    amount: p.amount,
    paymentMethod: p.payment_method,
    notes: p.notes,
    createdAt: p.created_at.toISOString(),
  }));

  const adjRes = await client.query<{
    id: string | number;
    adjustment_number: string;
    payment_id: string | number;
    receipt_number: string;
    adjustment_type: "ENTRY_REVERSAL" | "CASH_REFUND";
    adjustment_amount: string;
    reason: string;
    authorized_by_owner_id: string;
    authorized_by_owner_name: string;
    created_at: Date;
  }>(
    `SELECT
       pa.id,
       pa.adjustment_number,
       pa.payment_id,
       p.receipt_number,
       pa.adjustment_type,
       pa.adjustment_amount::text AS adjustment_amount,
       pa.reason,
       pa.authorized_by_owner_id,
       u.full_name AS authorized_by_owner_name,
       pa.created_at
     FROM public.payment_adjustments pa
     JOIN public.payments p ON p.id = pa.payment_id
     JOIN public.users u ON u.id = pa.authorized_by_owner_id
     WHERE p.invoice_id = $1
     ORDER BY pa.created_at ASC, pa.id ASC`,
    [invoiceId]
  );

  return {
    ...mapSummaryRow(header),
    items,
    payments,
    adjustments: adjRes.rows.map((a) => ({
      id: Number(a.id),
      adjustmentNumber: a.adjustment_number,
      paymentId: Number(a.payment_id),
      receiptNumber: a.receipt_number,
      adjustmentType: a.adjustment_type,
      adjustmentAmount: a.adjustment_amount,
      reason: a.reason,
      authorizedByOwnerId: a.authorized_by_owner_id,
      authorizedByOwnerName: a.authorized_by_owner_name,
      createdAt: a.created_at.toISOString(),
    })),
  };
}
