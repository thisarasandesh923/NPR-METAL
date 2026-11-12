import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { OperationalApprovalStatus } from "../approvals/approvals.repository.js";
import type { ProductionService } from "./production.service.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const payloadSchema = z.object({
  productionDate: z.string().regex(DATE_REGEX, "productionDate must be YYYY-MM-DD."),
  materialId: z.number().int().positive(),
  machineId: z.number().int().positive().optional().nullable(),
  operatorWorkerId: z.number().int().positive().optional().nullable(),
  shiftLabel: z.string().trim().max(40).optional().nullable(),
  quantityProduced: z.union([z.string().trim().min(1), z.number().finite()]),
  remarks: z.string().trim().max(500).optional().nullable(),
});

const updateSchema = payloadSchema.extend({
  expectedVersion: z.number().int().positive(),
});

const versionSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "RETURNED_FOR_CORRECTION"]),
  reason: z.string().trim().max(500).optional().nullable(),
  expectedVersion: z.number().int().positive(),
});

function parseIdParam(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const num = Number(s);
  if (!Number.isInteger(num) || num <= 0) {
    throw new ValidationError("Invalid production log id.");
  }
  return num;
}

export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const dateFrom = typeof req.query.dateFrom === "string" && DATE_REGEX.test(req.query.dateFrom) ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" && DATE_REGEX.test(req.query.dateTo) ? req.query.dateTo : undefined;
    const materialId = typeof req.query.materialId === "string" ? Number(req.query.materialId) : undefined;
    const machineId = typeof req.query.machineId === "string" ? Number(req.query.machineId) : undefined;
    const status = typeof req.query.status === "string" ? (req.query.status as OperationalApprovalStatus) : undefined;

    const logs = await this.productionService.listLogs({
      dateFrom,
      dateTo,
      materialId: Number.isInteger(materialId) && materialId! > 0 ? materialId : undefined,
      machineId: Number.isInteger(machineId) && machineId! > 0 ? machineId : undefined,
      status,
    });
    res.status(200).json({ success: true, data: { productionLogs: logs } });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid production input.");
    }
    const log = await this.productionService.createDraft(parsed.data, {
      userId: req.auth.user.id,
    });
    res.status(201).json({ success: true, data: { productionLog: log } });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid production update.");
    }
    const { expectedVersion, ...rest } = parsed.data;
    const log = await this.productionService.updateDraft(id, expectedVersion, rest, {
      userId: req.auth.user.id,
      role: req.auth.user.role,
    });
    res.status(200).json({ success: true, data: { productionLog: log } });
  };

  submit = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id);
    const parsed = versionSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("expectedVersion is required.");
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const log = await this.productionService.submit(id, parsed.data.expectedVersion, {
      userId: req.auth.user.id,
      role: req.auth.user.role,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { productionLog: log } });
  };

  cancel = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id);
    const parsed = versionSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("expectedVersion is required.");
    const log = await this.productionService.cancelDraft(id, parsed.data.expectedVersion, {
      userId: req.auth.user.id,
      role: req.auth.user.role,
    });
    res.status(200).json({ success: true, data: { productionLog: log } });
  };

  review = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id);
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid review payload.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const log = await this.productionService.review(id, parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { productionLog: log } });
  };
}

