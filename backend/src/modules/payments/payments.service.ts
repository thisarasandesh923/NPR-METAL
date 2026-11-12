import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../errors/appError.js";
import { formatScaledDecimal, parseScaledDecimal } from "../../utils/money.js";
import { insertAuthAuditLog } from "../auth/auth.repository.js";
import {
  acquireIdempotencyLock,
  deleteExpiredIdempotencyRecord,
  findIdempotencyRecord,
  findInvoiceDetailById,
  insertIdempotencyRecord,
} from "../invoices/invoices.repository.js";
import type {
  InvoiceDetailDto,
  InvoicePaymentDto,
} from "../invoices/invoices.types.js";
import {
  insertCashPayment,
  lockInvoicePaymentBounds,
} from "./payments.repository.js";
import type { RecordPaymentInput } from "./payments.types.js";

function computePaymentRequestHash(
  actorUserId: string,
  input: RecordPaymentInput
): string {
  const canonical = {
    actorUserId,
    invoiceId: input.invoiceId,
    amount: String(input.amount).trim(),
    notes: input.notes?.trim() ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function parsePositivePaymentCents(raw: string | number): bigint {
  let cents: bigint;
  try {
    cents = parseScaledDecimal(raw, 2, "Payment amount");
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : "Invalid payment amount."
    );
  }
  if (cents <= 0n || cents > 9_999_999_999_99n) {
    throw new ValidationError(
      "Payment amount must be greater than Rs. 0.00."
    );
  }
  return cents;
}

export class PaymentsService {
  constructor(private readonly pool: Pool) {}

  async recordCashPayment(
    input: RecordPaymentInput,
    actor: { userId: string; ipAddress: string }
  ): Promise<{
    payment: InvoicePaymentDto;
    invoice: InvoiceDetailDto;
    replayed: boolean;
  }> {
    const amountCents = parsePositivePaymentCents(input.amount);
    const requestHash = computePaymentRequestHash(actor.userId, input);

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      await acquireIdempotencyLock(
        client,
        "RECORD_PAYMENT",
        input.idempotencyKey
      );
      const existingIdem = await findIdempotencyRecord(
        client,
        input.idempotencyKey
      );

      if (existingIdem) {
        if (existingIdem.expires_at.getTime() <= Date.now()) {
          await deleteExpiredIdempotencyRecord(client, input.idempotencyKey);
        } else {
          if (
            existingIdem.operation_type !== "RECORD_PAYMENT" ||
            existingIdem.actor_user_id !== actor.userId ||
            existingIdem.request_hash !== requestHash
          ) {
            throw new ConflictError(
              "Idempotency key has already been used for a different payment.",
              "IDEMPOTENCY_CONFLICT"
            );
          }
          const payload = existingIdem.response_payload as {
            payment: InvoicePaymentDto;
            invoice: InvoiceDetailDto;
          };
          await client.query("COMMIT");
          inTx = false;
          return {
            payment: payload.payment,
            invoice: payload.invoice,
            replayed: true,
          };
        }
      }

      const bounds = await lockInvoicePaymentBounds(client, input.invoiceId);
      if (!bounds) {
        throw new NotFoundError("Invoice not found.");
      }

      if (bounds.status !== "ISSUED") {
        throw new ConflictError(
          `Payments cannot be recorded on an invoice with status ${bounds.status}.`
        );
      }

      const grandTotalCents = parseScaledDecimal(
        bounds.grandTotal,
        2,
        "Grand total"
      );
      const creditedCents = parseScaledDecimal(
        bounds.creditedAmount,
        2,
        "Credited total"
      );
      const grossPaidCents = parseScaledDecimal(
        bounds.grossPaidAmount,
        2,
        "Paid total"
      );
      const adjustedCents = parseScaledDecimal(
        bounds.adjustedAmount,
        2,
        "Adjusted total"
      );

      const effectiveTotalCents = grandTotalCents - creditedCents;
      const effectivePaidCents = grossPaidCents - adjustedCents;
      const remainingCents = effectiveTotalCents - effectivePaidCents;

      if (remainingCents <= 0n) {
        throw new ConflictError(
          `Invoice ${bounds.invoiceNumber} has no remaining balance due.`
        );
      }

      if (amountCents > remainingCents) {
        throw new ValidationError(
          `Payment amount exceeds remaining balance due (Rs. ${formatScaledDecimal(remainingCents, 2)}).`
        );
      }

      const amountFormatted = formatScaledDecimal(amountCents, 2);
      const created = await insertCashPayment(client, {
        invoiceId: bounds.id,
        cashierUserId: actor.userId,
        amount: amountFormatted,
        idempotencyKey: input.idempotencyKey,
        notes: input.notes?.trim() || null,
      });

      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action: "RECORD_PAYMENT",
        entityType: "PAYMENT",
        entityId: String(created.id),
        details: {
          invoiceId: bounds.id,
          invoiceNumber: bounds.invoiceNumber,
          receiptNumber: created.receipt_number,
          amount: amountFormatted,
        },
        ipAddress: actor.ipAddress,
      });

      const updatedInvoice = await findInvoiceDetailById(client, bounds.id);
      if (!updatedInvoice) {
        throw new Error("Updated invoice could not be loaded after payment.");
      }

      const createdPayment = updatedInvoice.payments.find(
        (p) => p.id === Number(created.id)
      );
      if (!createdPayment) {
        throw new Error("Created payment receipt missing from reloaded invoice.");
      }

      const responsePayload = {
        payment: createdPayment,
        invoice: updatedInvoice,
      };

      await insertIdempotencyRecord(client, {
        idempotencyKey: input.idempotencyKey,
        operationType: "RECORD_PAYMENT",
        requestHash,
        actorUserId: actor.userId,
        responseStatus: 201,
        responsePayload,
      });

      await client.query("COMMIT");
      inTx = false;
      return { ...responsePayload, replayed: false };
    } catch (err) {
      if (inTx) {
        await client.query("ROLLBACK").catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
