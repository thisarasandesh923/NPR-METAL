import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { OperationalApprovalStatus } from "../approvals/approvals.repository.js";
import type { MachinesService } from "./machines.service.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const createMachineSchema = z.object({
  machineCode: z.string().trim().min(2).max(20),
  machineName: z.string().trim().min(2).max(100),
  machineType: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateMachineSchema = z.object({
  machineName: z.string().trim().min(2).max(100),
  machineType: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean(),
});

const logPayloadSchema = z.object({
  workDate: z.string().regex(DATE_REGEX, "workDate must be YYYY-MM-DD."),
  machineId: z.number().int().positive(),
  operatorWorkerId: z.number().int().positive().optional().nullable(),
  startTime: z.string().trim().min(4).max(8),
  endTime: z.string().trim().min(4).max(8),
  crossesMidnight: z.boolean().default(false),
  downtimeMinutes: z.number().int().min(0).max(1440).default(0),
  downtimeReason: z.string().trim().max(500).optional().nullable(),
  scheduledHours: z
    .union([z.string().trim(), z.number().finite()])
    .optional()
    .nullable(),
  remarks: z.string().trim().max(500).optional().nullable(),
});

const updateLogSchema = logPayloadSchema.extend({
  expectedVersion: z.number().int().positive(),
});

const versionBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
});

const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "RETURNED_FOR_CORRECTION"]),
  reason: z.string().trim().max(500).optional().nullable(),
  expectedVersion: z.number().int().positive(),
});

function parseIdParam(raw: string | string[] | undefined, label: string): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const num = Number(s);
  if (!Number.isInteger(num) || num <= 0) throw new ValidationError(`Invalid ${label}.`);
  return num;
}

export class MachinesController {
  constructor(private readonly machinesService: MachinesService) {}

  listMachines = async (req: Request, res: Response): Promise<void> => {
    const includeInactive = req.query.includeInactive === "true";
    const machines = await this.machinesService.getMachines(includeInactive);
    res.status(200).json({ success: true, data: { machines } });
  };

  createMachine = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = createMachineSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid machine payload.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const machine = await this.machinesService.createMachine(parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(201).json({ success: true, data: { machine } });
  };

  updateMachine = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const machineId = parseIdParam(req.params.id, "machine id");
    const parsed = updateMachineSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid machine update.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const machine = await this.machinesService.updateMachine(machineId, parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { machine } });
  };

  listLogs = async (req: Request, res: Response): Promise<void> => {
    const dateFrom = typeof req.query.dateFrom === "string" && DATE_REGEX.test(req.query.dateFrom) ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" && DATE_REGEX.test(req.query.dateTo) ? req.query.dateTo : undefined;
    const machineId = typeof req.query.machineId === "string" ? Number(req.query.machineId) : undefined;
    const status = typeof req.query.status === "string" ? (req.query.status as OperationalApprovalStatus) : undefined;

    const logs = await this.machinesService.listLogs({
      dateFrom,
      dateTo,
      machineId: Number.isInteger(machineId) && machineId! > 0 ? machineId : undefined,
      status,
    });
    res.status(200).json({ success: true, data: { machineLogs: logs } });
  };

  createLog = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = logPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid machine log input.");
    }
    const log = await this.machinesService.createLogDraft(parsed.data, {
      userId: req.auth.user.id,
    });
    res.status(201).json({ success: true, data: { machineLog: log } });
  };

  updateLog = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id, "machine log id");
    const parsed = updateLogSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid machine log update.");
    }
    const { expectedVersion, ...rest } = parsed.data;
    const log = await this.machinesService.updateLogDraft(id, expectedVersion, rest, {
      userId: req.auth.user.id,
      role: req.auth.user.role,
    });
    res.status(200).json({ success: true, data: { machineLog: log } });
  };

  submitLog = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id, "machine log id");
    const parsed = versionBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("expectedVersion is required.");
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const log = await this.machinesService.submitLog(id, parsed.data.expectedVersion, {
      userId: req.auth.user.id,
      role: req.auth.user.role,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { machineLog: log } });
  };

  cancelLog = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id, "machine log id");
    const parsed = versionBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("expectedVersion is required.");
    const log = await this.machinesService.cancelLogDraft(id, parsed.data.expectedVersion, {
      userId: req.auth.user.id,
      role: req.auth.user.role,
    });
    res.status(200).json({ success: true, data: { machineLog: log } });
  };

  reviewLog = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id, "machine log id");
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid review payload.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const log = await this.machinesService.reviewLog(id, parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { machineLog: log } });
  };
}

