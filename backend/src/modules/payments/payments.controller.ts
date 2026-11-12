import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { PaymentsService } from "./payments.service.js";

const recordPaymentSchema = z.object({
  invoiceId: z.number().int().positive("Valid invoiceId is required."),
  amount: z.union([z.string().trim().min(1), z.number().finite()]),
  idempotencyKey: z
    .string({ error: "Idempotency key is required." })
    .trim()
    .min(16, "Idempotency key must be at least 16 characters.")
    .max(64, "Idempotency key must be at most 64 characters."),
  notes: z.string().trim().max(500).optional().nullable(),
});

export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

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
}
