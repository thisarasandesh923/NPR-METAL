import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../errors/appError.js";
import {
  computeLineTotalCents,
  formatScaledDecimal,
  parseScaledDecimal,
} from "../../utils/money.js";
import { insertAuthAuditLog } from "../auth/auth.repository.js";
import {
  findCustomerById,
  insertCustomer,
} from "../customers/customers.repository.js";
import { findActiveMaterialsWithVehiclePrices } from "../materials/materials.repository.js";
import { insertCashPayment } from "../payments/payments.repository.js";
import {
  acquireIdempotencyLock,
  deleteExpiredIdempotencyRecord,
  finalizeDraftInvoice,
  findIdempotencyRecord,
  findInvoiceDetailById,
  insertDraftInvoice,
  insertIdempotencyRecord,
  insertInvoiceItem,
  listIssuedInvoices,
} from "./invoices.repository.js";
import type {
  CreateInvoiceInput,
  InvoiceDetailDto,
  InvoiceSummaryDto,
} from "./invoices.types.js";

function computeInvoiceRequestHash(
  actorUserId: string,
  input: CreateInvoiceInput
): string {
  const canonical = {
    actorUserId,
    customerId: input.customerId ?? null,
    customer: input.customer
      ? {
          name: input.customer.name.trim(),
          phone: input.customer.phone.trim(),
          location: input.customer.location.trim(),
          notes: input.customer.notes?.trim() ?? null,
        }
      : null,
    vehicleCategory: input.vehicleCategory ?? null,
    items: input.items.map((item) => ({
      materialId: item.materialId,
      quantity: String(item.quantity).trim(),
    })),
    hasTransport: input.hasTransport,
    transportFee: String(input.transportFee).trim(),
    initialPaymentAmount: String(input.initialPaymentAmount ?? "0").trim(),
    ...(input.initialCashTendered !== undefined
      ? { initialCashTendered: String(input.initialCashTendered).trim() }
      : {}),
    initialPaymentNotes: input.initialPaymentNotes?.trim() ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function parsePositiveQuantityMilli(raw: string | number): bigint {
  let qtyMilli: bigint;
  try {
    qtyMilli = parseScaledDecimal(raw, 3, "Quantity");
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : "Invalid material quantity."
    );
  }
  if (qtyMilli <= 0n || qtyMilli > 100_000_000n) {
    throw new ValidationError(
      "Quantity must be greater than 0.000 and at most 100,000.000."
    );
  }
  return qtyMilli;
}

function parseMoneyCents(
  raw: string | number,
  fieldName: string
): bigint {
  let cents: bigint;
  try {
    cents = parseScaledDecimal(raw, 2, fieldName);
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : `Invalid ${fieldName}.`
    );
  }
  if (cents > 9_999_999_999_99n) {
    throw new ValidationError(`${fieldName} exceeds maximum allowed amount.`);
  }
  return cents;
}

export class InvoicesService {
  constructor(private readonly pool: Pool) {}

  async listInvoices(filters: {
    q?: string;
    paymentStatus?: string;
    limit?: number;
  }): Promise<InvoiceSummaryDto[]> {
    return listIssuedInvoices(this.pool, {
      q: filters.q,
      paymentStatus: filters.paymentStatus,
      limit: Math.min(Math.max(filters.limit ?? 50, 1), 100),
    });
  }

  async getInvoiceById(invoiceId: number): Promise<InvoiceDetailDto> {
    const detail = await findInvoiceDetailById(this.pool, invoiceId);
    if (!detail) {
      throw new NotFoundError("Invoice not found.");
    }
    return detail;
  }

  async issueInvoice(
    input: CreateInvoiceInput,
    actor: { userId: string; ipAddress: string }
  ): Promise<{ invoice: InvoiceDetailDto; replayed: boolean }> {
    if (!input.vehicleCategory || (input.vehicleCategory !== "TRACTOR" && input.vehicleCategory !== "TIPPER")) {
      throw new ValidationError("Vehicle category (TRACTOR or TIPPER) is required.");
    }

    const transportFeeCents = input.hasTransport
      ? parseMoneyCents(input.transportFee, "Transport fee")
      : (() => {
          const submittedFee = parseMoneyCents(
            input.transportFee,
            "Transport fee"
          );
          if (submittedFee !== 0n) {
            throw new ValidationError(
              "Transport fee must be 0.00 when Without Transport is selected."
            );
          }
          return 0n;
        })();

    const initialPaymentCents =
      input.initialPaymentAmount !== undefined
        ? parseMoneyCents(input.initialPaymentAmount, "Initial payment")
        : 0n;

    const initialCashTenderedCents =
      input.initialCashTendered !== undefined
        ? parseMoneyCents(input.initialCashTendered, "Initial cash tendered")
        : null;

    if (initialCashTenderedCents !== null) {
      if (initialPaymentCents <= 0n) {
        throw new ValidationError(
          "Cash tendered requires a positive initial payment."
        );
      }

      if (initialCashTenderedCents < initialPaymentCents) {
        throw new ValidationError(
          "Cash tendered cannot be less than the initial payment."
        );
      }
    }

    const initialChangeReturnedCents =
      initialCashTenderedCents === null
        ? null
        : initialCashTenderedCents - initialPaymentCents;

    const normalizedItems = input.items.map((item) => ({
      materialId: item.materialId,
      quantityMilli: parsePositiveQuantityMilli(item.quantity),
    }));

    const requestHash = computeInvoiceRequestHash(actor.userId, input);

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      await acquireIdempotencyLock(client, "ISSUE_INVOICE", input.idempotencyKey);
      const existingIdem = await findIdempotencyRecord(
        client,
        input.idempotencyKey
      );
      if (existingIdem) {
        if (existingIdem.expires_at.getTime() <= Date.now()) {
          await deleteExpiredIdempotencyRecord(client, input.idempotencyKey);
        } else {
          if (
            existingIdem.operation_type !== "ISSUE_INVOICE" ||
            existingIdem.actor_user_id !== actor.userId ||
            existingIdem.request_hash !== requestHash
          ) {
            throw new ConflictError(
              "Idempotency key has already been used for a different request.",
              "IDEMPOTENCY_CONFLICT"
            );
          }
          const payload = existingIdem.response_payload as {
            invoice: InvoiceDetailDto;
          };
          await client.query("COMMIT");
          inTx = false;
          return { invoice: payload.invoice, replayed: true };
        }
      }

      // Resolve customer snapshot cleanly inside transaction
      let resolvedCustomer: {
        id: number;
        name: string;
        phone: string;
        location: string;
      };
      if (input.customerId !== undefined) {
        const found = await findCustomerById(client, input.customerId);
        if (!found) {
          throw new NotFoundError("Selected customer was not found.");
        }
        resolvedCustomer = {
          id: Number(found.id),
          name: found.name,
          phone: found.phone,
          location: found.location,
        };
      } else if (input.customer) {
        const created = await insertCustomer(client, input.customer);
        resolvedCustomer = {
          id: Number(created.id),
          name: created.name,
          phone: created.phone,
          location: created.location,
        };
      } else {
        throw new ValidationError(
          "Either an existing customer or new customer details must be provided."
        );
      }

      // Load authoritative server-side material prices for selected vehicle category
      const uniqueMaterialIds = Array.from(
        new Set(normalizedItems.map((i) => i.materialId))
      );
      const materialRows = await findActiveMaterialsWithVehiclePrices(
        client,
        uniqueMaterialIds,
        input.vehicleCategory
      );
      const materialsById = new Map(materialRows.map((m) => [m.id, m]));

      let subtotalCents = 0n;
      const computedLines = normalizedItems.map((item) => {
        const mat = materialsById.get(item.materialId);
        if (!mat) {
          throw new ValidationError(
            `Material #${item.materialId} is invalid or inactive.`
          );
        }
        if (mat.price_per_ft3 === null || mat.price_per_ft3 === undefined || mat.price_per_ft3.trim() === "") {
          throw new ValidationError(
            `Material "${mat.name}" does not have an active price configured for ${input.vehicleCategory}. Please set the price before issuing invoices.`
          );
        }
        const unitPriceCents = parseScaledDecimal(
          mat.price_per_ft3,
          2,
          "Material unit price"
        );
        if (unitPriceCents < 0n) {
          throw new ValidationError(
            `Material "${mat.name}" unit price cannot be negative.`
          );
        }
        const lineTotalCents = computeLineTotalCents(
          item.quantityMilli,
          unitPriceCents
        );
        subtotalCents += lineTotalCents;

        return {
          materialId: mat.id,
          materialName: mat.name,
          quantity: formatScaledDecimal(item.quantityMilli, 3),
          unitPrice: formatScaledDecimal(unitPriceCents, 2),
          lineTotal: formatScaledDecimal(lineTotalCents, 2),
          unitSnapshot: "ft³",
          vehicleCategorySnapshot: input.vehicleCategory,
        };
      });

      const grandTotalCents = subtotalCents + transportFeeCents;
      if (initialPaymentCents > grandTotalCents) {
        throw new ValidationError(
          `Initial payment (Rs. ${formatScaledDecimal(initialPaymentCents, 2)}) cannot exceed grand total (Rs. ${formatScaledDecimal(grandTotalCents, 2)}).`
        );
      }

      const draft = await insertDraftInvoice(client, {
        customerId: resolvedCustomer.id,
        customerNameSnapshot: resolvedCustomer.name,
        customerPhoneSnapshot: resolvedCustomer.phone,
        customerLocationSnapshot: resolvedCustomer.location,
        hasTransport: input.hasTransport,
        transportFee: formatScaledDecimal(transportFeeCents, 2),
        issuedByUserId: actor.userId,
        vehicleCategory: input.vehicleCategory,
        unitSnapshot: "ft³",
      });

      for (const line of computedLines) {
        await insertInvoiceItem(client, {
          invoiceId: draft.id,
          materialId: line.materialId,
          materialNameSnapshot: line.materialName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          unitSnapshot: line.unitSnapshot,
          vehicleCategorySnapshot: line.vehicleCategorySnapshot,
        });
      }

      await finalizeDraftInvoice(client, {
        invoiceId: draft.id,
        subtotal: formatScaledDecimal(subtotalCents, 2),
        grandTotal: formatScaledDecimal(grandTotalCents, 2),
      });

      let initialReceiptNumber: string | null = null;
      if (initialPaymentCents > 0n) {
        const initPayKey = createHash("sha256")
          .update(`initpay:${input.idempotencyKey}`)
          .digest("hex");
        const createdPayment = await insertCashPayment(client, {
          invoiceId: draft.id,
          cashierUserId: actor.userId,
          amount: formatScaledDecimal(initialPaymentCents, 2),
          cashTendered:
            initialCashTenderedCents === null
              ? null
              : formatScaledDecimal(initialCashTenderedCents, 2),
          changeReturned:
            initialChangeReturnedCents === null
              ? null
              : formatScaledDecimal(initialChangeReturnedCents, 2),
          idempotencyKey: initPayKey,
          notes:
            input.initialPaymentNotes?.trim() || "Initial cash payment at invoice issue",
        });
        initialReceiptNumber = createdPayment.receipt_number;
      }

      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action: "ISSUE_INVOICE",
        entityType: "INVOICE",
        entityId: String(draft.id),
        details: {
          invoiceNumber: draft.invoiceNumber,
          customerId: resolvedCustomer.id,
          vehicleCategory: input.vehicleCategory,
          unitSnapshot: "ft³",
          grandTotal: formatScaledDecimal(grandTotalCents, 2),
          initialPayment: formatScaledDecimal(initialPaymentCents, 2),
          initialCashTendered:
            initialCashTenderedCents === null
              ? null
              : formatScaledDecimal(initialCashTenderedCents, 2),
          initialChangeReturned:
            initialChangeReturnedCents === null
              ? null
              : formatScaledDecimal(initialChangeReturnedCents, 2),
          initialReceiptNumber,
          itemCount: computedLines.length,
        },
        ipAddress: actor.ipAddress,
      });

      const persistedInvoice = await findInvoiceDetailById(client, draft.id);
      if (!persistedInvoice) {
        throw new Error("Persisted invoice could not be reloaded after issuance.");
      }

      await insertIdempotencyRecord(client, {
        idempotencyKey: input.idempotencyKey,
        operationType: "ISSUE_INVOICE",
        requestHash,
        actorUserId: actor.userId,
        responseStatus: 201,
        responsePayload: { invoice: persistedInvoice },
      });

      await client.query("COMMIT");
      inTx = false;
      return { invoice: persistedInvoice, replayed: false };
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
