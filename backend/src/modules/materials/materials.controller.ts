import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { MaterialsService } from "./materials.service.js";

const updatePriceSchema = z.object({
  newPrice: z.union([z.string().trim().min(1), z.number().finite()]),
  reason: z
    .string({ error: "Price change reason is required." })
    .trim()
    .min(5, "Reason must be at least 5 characters.")
    .max(500, "Reason must be at most 500 characters."),
  expectedVersion: z
    .number({ error: "expectedVersion is required." })
    .int()
    .positive("expectedVersion must be a positive integer."),
});

export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  listActive = async (_req: Request, res: Response): Promise<void> => {
    const materials = await this.materialsService.getActiveMaterials();
    res.status(200).json({
      success: true,
      data: { materials },
    });
  };

  listHistory = async (req: Request, res: Response): Promise<void> => {
    let materialId: number | undefined;
    if (req.query.materialId !== undefined) {
      const parsed = Number(req.query.materialId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ValidationError("Invalid materialId filter.");
      }
      materialId = parsed;
    }

    const history = await this.materialsService.getPriceHistory(materialId);
    res.status(200).json({
      success: true,
      data: { history },
    });
  };

  updatePrice = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthorizedError("Authentication required.");
    }

    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const materialId = Number(rawId);
    if (!Number.isInteger(materialId) || materialId <= 0) {
      throw new ValidationError("Invalid material ID.");
    }

    const parsed = updatePriceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid price update payload."
      );
    }

    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(
      0,
      45
    );
    const material = await this.materialsService.updatePrice(
      {
        materialId,
        newPrice: parsed.data.newPrice,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expectedVersion,
      },
      {
        ownerUserId: req.auth.user.id,
        ipAddress,
      }
    );

    res.status(200).json({
      success: true,
      data: { material },
    });
  };
}
