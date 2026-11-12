import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { InvoicesService } from "./invoices.service.js";

const PAYMENT_STATUS_FILTERS = new Set([
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
  "REFUND_DUE",
]);

const decimalInputSchema = z.union([
  z.string().trim().min(1),
  z.number().finite(),
]);

const createInvoiceSchema = z
  .object({
    customerId: z.number().int().positive().optional(),
    customer: z
      .object({
        name: z
          .string()
          .trim()
          .min(2, "Customer name must be at least 2 characters.")
          .max(150, "Customer name must be at most 150 characters."),
        phone: z
          .string()
          .trim()
          .min(7, "Phone number must be at least 7 characters.")
          .max(20, "Phone number must be at most 20 characters."),
        location: z
          .string()
          .trim()
          .min(2, "Location must be at least 2 characters.")
          .max(255, "Location must be at most 255 characters."),
        notes: z.string().trim().max(500).optional().nullable(),
      })
      .optional(),
    items: z
      .array(
        z.object({
          materialId: z.number().int().positive(),
          quantity: decimalInputSchema,
        })
      )
      .min(1, "At least one material item is required.")
      .max(50, "Cannot exceed 50 items per invoice."),
    hasTransport: z.boolean(),
    transportFee: decimalInputSchema,
    initialPaymentAmount: decimalInputSchema.optional(),
    initialPaymentNotes: z.string().trim().max(500).optional().nullable(),
    idempotencyKey: z
      .string({ error: "Idempotency key is required." })
      .trim()
      .min(16, "Idempotency key must be at least 16 characters.")
      .max(64, "Idempotency key must be at most 64 characters."),
  })
  .refine(
    (data) =>
      (data.customerId !== undefined) !== (data.customer !== undefined),
    {
      message:
        "Provide either customerId for an existing customer or customer details for a new customer.",
    }
  );

export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : undefined;
    const statusRaw =
      typeof req.query.status === "string" ? req.query.status.trim() : undefined;
    if (statusRaw && !PAYMENT_STATUS_FILTERS.has(statusRaw)) {
      throw new ValidationError("Invalid invoice payment status filter.");
    }

    const limitRaw =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 50;

    const invoices = await this.invoicesService.listInvoices({
      q,
      paymentStatus: statusRaw,
      limit,
    });

    res.status(200).json({
      success: true,
      data: { invoices },
    });
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const invoiceId = Number(rawId);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new ValidationError("Invalid invoice identifier.");
    }

    const invoice = await this.invoicesService.getInvoiceById(invoiceId);
    res.status(200).json({
      success: true,
      data: { invoice },
    });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthorizedError("Authentication required.");
    }

    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid invoice request payload."
      );
    }

    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(
      0,
      45
    );
    const result = await this.invoicesService.issueInvoice(parsed.data, {
      userId: req.auth.user.id,
      ipAddress,
    });

    res.status(201).json({
      success: true,
      data: {
        invoice: result.invoice,
        replayed: result.replayed,
      },
    });
  };
}
