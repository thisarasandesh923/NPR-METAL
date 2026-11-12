import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { CustomersService } from "./customers.service.js";

const createCustomerSchema = z.object({
  name: z
    .string({ error: "Customer name is required." })
    .trim()
    .min(2, "Customer name must be at least 2 characters.")
    .max(150, "Customer name must be at most 150 characters."),
  phone: z
    .string({ error: "Phone number is required." })
    .trim()
    .min(7, "Phone number must be at least 7 characters.")
    .max(20, "Phone number must be at most 20 characters."),
  location: z
    .string({ error: "Location is required." })
    .trim()
    .min(2, "Location must be at least 2 characters.")
    .max(255, "Location must be at most 255 characters."),
  notes: z.string().trim().max(500).optional().nullable(),
});

export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  search = async (req: Request, res: Response): Promise<void> => {
    const rawQuery = typeof req.query.q === "string" ? req.query.q : "";
    if (rawQuery.length > 100) {
      throw new ValidationError("Search query exceeds 100 characters.");
    }
    const customers = await this.customersService.listOrSearch(rawQuery);
    res.status(200).json({
      success: true,
      data: { customers },
    });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthorizedError("Authentication required.");
    }
    const parsed = createCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid customer payload."
      );
    }

    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(
      0,
      45
    );
    const customer = await this.customersService.create(parsed.data, {
      userId: req.auth.user.id,
      ipAddress,
    });

    res.status(201).json({
      success: true,
      data: { customer },
    });
  };
}
