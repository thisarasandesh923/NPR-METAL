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
  InvoicePaymentAdjustmentDto,
  InvoicePaymentDto,
} from "../invoices/invoices.types.js";
import {
  insertCashPayment,
  insertPaymentAdjustment,
  lockInvoicePaymentBounds,
  lockPaymentForAdjustment,
} from "./payments.repository.js";
import type {
  AdjustPaymentInput,
  RecordPaymentInput,
} from "./payments.types.js";

function computeAdjustmentRequestHash(
  actorUserId: string,
  input: AdjustPaymentInput
): string {
  const canonical = {
    actorUserId,
    paymentId: input.paymentId,
    adjustmentType: input.adjustmentType,
    amount: String(input.amount).trim(),
    reason: input.reason.trim(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function computePaymentRequestHash(
  actorUserId: string,
  input: RecordPaymentInput
): string {
  const canonical = {
    actorUserId,
    invoiceId: input.invoiceId,
    amount: String(input.amount).trim(),
    notes: input.notes?.trim() ?? null,
    ...(input.cashTendered !== undefined
      ? { cashTendered: String(input.cashTendered).trim() }
      : {}),
  };

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
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

function calculateCashChange(
  paymentAmount: string | number,
  cashTendered?: string | number
): {
  cashTendered: string | null;
  changeReturned: string | null;
} {
  // Keep legacy payment requests compatible.
  if (cashTendered === undefined) {
    return {
      cashTendered: null,
      changeReturned: null,
    };
  }

  let tenderedCents: bigint;

  try {
    tenderedCents = parseScaledDecimal(
      cashTendered,
      2,
      "Cash tendered"
    );
  } catch (error) {
    throw new ValidationError(
      error instanceof Error
        ? error.message
        : "Invalid cash tendered amount."
    );
  }

  const paymentCents = parsePositivePaymentCents(paymentAmount);

  if (tenderedCents < paymentCents) {
    throw new ValidationError(
      "Cash tendered cannot be less than the payment amount."
    );
  }

  if (tenderedCents > 999999999999n) {
    throw new ValidationError(
      "Cash tendered exceeds the maximum allowed amount."
    );
  }

  return {
    cashTendered: formatScaledDecimal(tenderedCents, 2),
    changeReturned: formatScaledDecimal(
      tenderedCents - paymentCents,
      2
    ),
  };
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
    const cashChange = calculateCashChange(input.amount, input.cashTendered);
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
        cashTendered: cashChange.cashTendered,
        changeReturned: cashChange.changeReturned,
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
          cashTendered: cashChange.cashTendered,
          changeReturned: cashChange.changeReturned,
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

  async adjustPaymentEntryReversal(
    input: AdjustPaymentInput,
    actor: { userId: string; ipAddress: string }
  ): Promise<{
    adjustment: InvoicePaymentAdjustmentDto;
    invoice: InvoiceDetailDto;
    replayed: boolean;
  }> {
    if (input.adjustmentType !== "ENTRY_REVERSAL") {
      throw new ValidationError(
        "Only ENTRY_REVERSAL is enabled; CASH_REFUND policy awaits owner confirmation."
      );
    }

    const amountCents = parsePositivePaymentCents(input.amount);
    const trimmedReason = input.reason.trim();
    if (trimmedReason.length < 10) {
      throw new ValidationError(
        "Adjustment reason must be at least 10 characters."
      );
    }
    const requestHash = computeAdjustmentRequestHash(actor.userId, input);

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      await acquireIdempotencyLock(
        client,
        "PAYMENT_ADJUSTMENT",
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
            existingIdem.operation_type !== "PAYMENT_ADJUSTMENT" ||
            existingIdem.actor_user_id !== actor.userId ||
            existingIdem.request_hash !== requestHash
          ) {
            throw new ConflictError(
              "Idempotency key has already been used for a different payment adjustment.",
              "IDEMPOTENCY_CONFLICT"
            );
          }
          const payload = existingIdem.response_payload as {
            adjustment: InvoicePaymentAdjustmentDto;
            invoice: InvoiceDetailDto;
          };
          await client.query("COMMIT");
          inTx = false;
          return { ...payload, replayed: true };
        }
      }

      const bounds = await lockPaymentForAdjustment(client, input.paymentId);
      if (!bounds) {
        throw new NotFoundError("Payment receipt not found.");
      }

      const originalCents = parseScaledDecimal(
        bounds.originalAmount,
        2,
        "Original payment amount"
      );
      const priorAdjustedCents = parseScaledDecimal(
        bounds.priorAdjustedAmount,
        2,
        "Prior adjusted amount"
      );
      const reversibleCents = originalCents - priorAdjustedCents;

      if (reversibleCents <= 0n) {
        throw new ConflictError(
          `Receipt ${bounds.receiptNumber} has already been fully reversed.`
        );
      }

      if (amountCents > reversibleCents) {
        throw new ValidationError(
          `Reversal amount exceeds remaining reversible balance on receipt ${bounds.receiptNumber} (Rs. ${formatScaledDecimal(reversibleCents, 2)}).`
        );
      }

      const amountFormatted = formatScaledDecimal(amountCents, 2);
      const created = await insertPaymentAdjustment(client, {
        paymentId: bounds.paymentId,
        ownerUserId: actor.userId,
        adjustmentType: "ENTRY_REVERSAL",
        adjustmentAmount: amountFormatted,
        reason: trimmedReason,
        idempotencyKey: input.idempotencyKey,
      });

      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action: "ADJUST_PAYMENT",
        entityType: "PAYMENT_ADJUSTMENT",
        entityId: String(created.id),
        details: {
          paymentId: bounds.paymentId,
          receiptNumber: bounds.receiptNumber,
          invoiceId: bounds.invoiceId,
          invoiceNumber: bounds.invoiceNumber,
          adjustmentNumber: created.adjustment_number,
          adjustmentType: "ENTRY_REVERSAL",
          amount: amountFormatted,
          reason: trimmedReason,
        },
        ipAddress: actor.ipAddress,
      });

      const updatedInvoice = await findInvoiceDetailById(client, bounds.invoiceId);
      if (!updatedInvoice) {
        throw new Error("Updated invoice could not be loaded after adjustment.");
      }

      const createdAdjustment = updatedInvoice.adjustments?.find(
        (a) => a.id === created.id
      );
      if (!createdAdjustment) {
        throw new Error("Created payment adjustment missing from invoice.");
      }

      const responsePayload = {
        adjustment: createdAdjustment,
        invoice: updatedInvoice,
      };

      await insertIdempotencyRecord(client, {
        idempotencyKey: input.idempotencyKey,
        operationType: "PAYMENT_ADJUSTMENT",
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

