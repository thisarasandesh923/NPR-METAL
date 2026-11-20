import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { PaymentsService } from "./payments.service.js";

const recordPaymentSchema = z.object({
  invoiceId: z.number().int().positive("Valid invoiceId is required."),
  amount: z.union([z.string().trim().min(1), z.number().finite()]),

  paymentMethod: z.literal("CASH").optional(),

  idempotencyKey: z
    .string({ error: "Idempotency key is required." })
    .trim()
    .min(16, "Idempotency key must be at least 16 characters.")
    .max(64, "Idempotency key must be at most 64 characters."),

  notes: z.string().trim().max(500).optional().nullable(),
});

const adjustPaymentSchema = z.object({
  adjustmentType: z.enum(["ENTRY_REVERSAL", "CASH_REFUND"]),
  amount: z.union([z.string().trim().min(1), z.number().finite()]),
  reason: z
    .string({ error: "Adjustment reason is required." })
    .trim()
    .min(10, "Reason must be at least 10 characters.")
    .max(500),
  idempotencyKey: z
    .string({ error: "Idempotency key is required." })
    .trim()
    .min(16, "Idempotency key must be at least 16 characters.")
    .max(64, "Idempotency key must be at most 64 characters."),
});

export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) { }

  record = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthorizedError("Authentication required.");
    }

    const parsed = recordPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid payment payload."
      );
    }

    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(
      0,
      45
    );
    const result = await this.paymentsService.recordCashPayment(parsed.data, {
      userId: req.auth.user.id,
      ipAddress,
    });

    res.status(201).json({
      success: true,
      data: {
        payment: result.payment,
        invoice: result.invoice,
        replayed: result.replayed,
      },
    });
  };

  adjust = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthorizedError("Authentication required.");
    }

    const paymentId = Number(req.params.id);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      throw new ValidationError("Valid numeric payment id is required.");
    }

    const parsed = adjustPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid adjustment payload."
      );
    }

    if (parsed.data.adjustmentType !== "ENTRY_REVERSAL") {
      throw new ValidationError(
        "Only ENTRY_REVERSAL is currently supported; customer CASH_REFUND workflow awaits owner policy confirmation."
      );
    }

    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(
      0,
      45
    );
    const result = await this.paymentsService.adjustPaymentEntryReversal(
      {
        paymentId,
        adjustmentType: "ENTRY_REVERSAL",
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        idempotencyKey: parsed.data.idempotencyKey,
      },
      {
        userId: req.auth.user.id,
        ipAddress,
      }
    );

    res.status(201).json({
      success: true,
      data: {
        adjustment: result.adjustment,
        invoice: result.invoice,
        replayed: result.replayed,
      },
    });
  };
}
