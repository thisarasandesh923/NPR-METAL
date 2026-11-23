import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { MaterialsService } from "./materials.service.js";
import type { VehicleCategory } from "./materials.types.js";

const updatePriceSchema = z.object({
  vehicleCategory: z.enum(["TRACTOR", "TIPPER"]).optional(),
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
  isActive: z.boolean().optional(),
});

export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  listMaterials = async (req: Request, res: Response): Promise<void> => {
    const isOwner = req.auth?.user.role === "OWNER";
    const includeInactive = isOwner && req.query.includeInactive === "true";
    const materials = await this.materialsService.getMaterials(includeInactive);
    res.status(200).json({
      success: true,
      data: { materials },
    });
  };

  listActive = this.listMaterials;

  listHistory = async (req: Request, res: Response): Promise<void> => {
    let materialId: number | undefined;
    if (req.query.materialId !== undefined && req.query.materialId !== "") {
      const parsed = Number(req.query.materialId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ValidationError("Invalid materialId filter.");
      }
      materialId = parsed;
    }

    let vehicleCategory: VehicleCategory | "ALL" | undefined;
    if (typeof req.query.vehicleCategory === "string" && req.query.vehicleCategory.trim() !== "") {
      const cat = req.query.vehicleCategory.trim().toUpperCase();
      if (cat === "TRACTOR" || cat === "TIPPER" || cat === "ALL") {
        vehicleCategory = cat as VehicleCategory | "ALL";
      } else {
        throw new ValidationError("Invalid vehicleCategory filter. Must be TRACTOR, TIPPER, or ALL.");
      }
    }

    const userId =
      typeof req.query.userId === "string" && req.query.userId.trim() !== ""
        ? req.query.userId.trim()
        : typeof req.query.cashierId === "string" && req.query.cashierId.trim() !== ""
        ? req.query.cashierId.trim()
        : undefined;

    const dateFrom =
      typeof req.query.dateFrom === "string" && req.query.dateFrom.trim() !== ""
        ? req.query.dateFrom.trim()
        : undefined;

    const dateTo =
      typeof req.query.dateTo === "string" && req.query.dateTo.trim() !== ""
        ? req.query.dateTo.trim()
        : undefined;

    const history = await this.materialsService.getPriceHistory({
      materialId,
      vehicleCategory,
      userId,
      dateFrom,
      dateTo,
    });

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

    if (parsed.data.isActive !== undefined && req.auth.user.role !== "OWNER") {
      throw new ValidationError(
        "Only Owner accounts are permitted to activate or deactivate materials."
      );
    }

    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(
      0,
      45
    );
    const material = await this.materialsService.updatePrice(
      {
        materialId,
        vehicleCategory: parsed.data.vehicleCategory,
        newPrice: parsed.data.newPrice,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expectedVersion,
        isActive: parsed.data.isActive,
      },
      {
        userId: req.auth.user.id,
        username: req.auth.user.username,
        role: req.auth.user.role,
        ipAddress,
      }
    );

    res.status(200).json({
      success: true,
      data: { material },
    });
  };
}
