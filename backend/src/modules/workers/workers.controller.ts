import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { OperationalApprovalStatus } from "../approvals/approvals.repository.js";
import type { WorkersService } from "./workers.service.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const createWorkerSchema = z.object({
  workerCode: z.string().trim().min(2).max(20),
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(20).optional().nullable(),
  designation: z.string().trim().min(2).max(60),
  joinedDate: z.string().regex(DATE_REGEX).optional().nullable(),
  employmentStatus: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE"]).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const updateWorkerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(20).optional().nullable(),
  designation: z.string().trim().min(2).max(60),
  joinedDate: z.string().regex(DATE_REGEX).optional().nullable(),
  employmentStatus: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE"]),
  notes: z.string().trim().max(500).optional().nullable(),
});

const attendancePayloadSchema = z.object({
  workDate: z.string().regex(DATE_REGEX, "workDate must be YYYY-MM-DD."),
  workerId: z.number().int().positive(),
  startTime: z.string().trim().min(4).max(8),
  endTime: z.string().trim().min(4).max(8),
  crossesMidnight: z.boolean().default(false),
  breakMinutes: z.number().int().min(0).max(720).default(0),
  overtimeHours: z.union([z.string().trim(), z.number().finite()]).default("0.00"),
  remarks: z.string().trim().max(500).optional().nullable(),
});

const updateAttendanceSchema = attendancePayloadSchema.extend({
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
  if (!Number.isInteger(num) || num <= 0) {
    throw new ValidationError(`Invalid ${label}.`);
  }
  return num;
}

export class WorkersController {
  constructor(private readonly workersService: WorkersService) {}

  listWorkers = async (req: Request, res: Response): Promise<void> => {
    const includeInactive = req.query.includeInactive === "true";
    const workers = await this.workersService.getWorkers(includeInactive);
    res.status(200).json({ success: true, data: { workers } });
  };

  createWorker = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = createWorkerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid worker payload.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const worker = await this.workersService.createWorker(parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(201).json({ success: true, data: { worker } });
  };

  updateWorker = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const workerId = parseIdParam(req.params.id, "worker id");
    const parsed = updateWorkerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid worker update.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const worker = await this.workersService.updateWorker(workerId, parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { worker } });
  };

  listAttendance = async (req: Request, res: Response): Promise<void> => {
    const dateFrom = typeof req.query.dateFrom === "string" && DATE_REGEX.test(req.query.dateFrom) ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" && DATE_REGEX.test(req.query.dateTo) ? req.query.dateTo : undefined;
    const workerId = typeof req.query.workerId === "string" ? Number(req.query.workerId) : undefined;
    const status = typeof req.query.status === "string" ? (req.query.status as OperationalApprovalStatus) : undefined;

    const records = await this.workersService.listAttendance({
      dateFrom,
      dateTo,
      workerId: Number.isInteger(workerId) && workerId! > 0 ? workerId : undefined,
      status,
    });
    res.status(200).json({ success: true, data: { attendance: records } });
  };

  createAttendance = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = attendancePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid attendance input.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const record = await this.workersService.createAttendanceDraft(parsed.data, {
      userId: req.auth.user.id,
      ipAddress,
    });
    res.status(201).json({ success: true, data: { attendance: record } });
  };

  updateAttendance = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id, "attendance id");
    const parsed = updateAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid attendance update.");
    }
    const { expectedVersion, ...rest } = parsed.data;
    const record = await this.workersService.updateAttendanceDraft(id, expectedVersion, rest, {
      userId: req.auth.user.id,
      role: req.auth.user.role,
    });
    res.status(200).json({ success: true, data: { attendance: record } });
  };

  submitAttendance = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id, "attendance id");
    const parsed = versionBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("expectedVersion is required.");
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const record = await this.workersService.submitAttendance(id, parsed.data.expectedVersion, {
      userId: req.auth.user.id,
      role: req.auth.user.role,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { attendance: record } });
  };

  cancelAttendance = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id, "attendance id");
    const parsed = versionBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("expectedVersion is required.");
    const record = await this.workersService.cancelAttendanceDraft(id, parsed.data.expectedVersion, {
      userId: req.auth.user.id,
      role: req.auth.user.role,
    });
    res.status(200).json({ success: true, data: { attendance: record } });
  };

  reviewAttendance = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseIdParam(req.params.id, "attendance id");
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid review payload.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const record = await this.workersService.reviewAttendance(id, parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { attendance: record } });
  };
}

