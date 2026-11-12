import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { PayrollService } from "./payroll.service.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const compensationSchema = z.object({
  workerId: z.number().int().positive(),
  payArrangement: z.enum(["HOURLY", "DAILY", "MONTHLY", "MANUAL"]),
  baseRate: z.union([z.string().trim(), z.number().finite()]).optional().nullable(),
  overtimeHourlyRate: z.union([z.string().trim(), z.number().finite()]).optional().nullable(),
  effectiveFrom: z.string().regex(DATE_REGEX),
  notes: z.string().trim().max(500).optional().nullable(),
});

const createPeriodSchema = z.object({
  periodLabel: z.string().trim().min(3).max(80),
  startDate: z.string().regex(DATE_REGEX),
  endDate: z.string().regex(DATE_REGEX),
  notes: z.string().trim().max(500).optional().nullable(),
});

const updateEntrySchema = z.object({
  expectedVersion: z.number().int().positive(),
  basePay: z.union([z.string().trim().min(1), z.number().finite()]),
  overtimePay: z.union([z.string().trim().min(1), z.number().finite()]),
  allowances: z.union([z.string().trim().min(1), z.number().finite()]),
  deductions: z.union([z.string().trim().min(1), z.number().finite()]),
  advanceDeduction: z.union([z.string().trim().min(1), z.number().finite()]),
  notes: z.string().trim().max(500).optional().nullable(),
});

const versionSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

const advanceSchema = z.object({
  workerId: z.number().int().positive(),
  advanceDate: z.string().regex(DATE_REGEX),
  amount: z.union([z.string().trim().min(1), z.number().finite()]),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(16).max(64),
});

const salaryPaymentSchema = z.object({
  paymentDate: z.string().regex(DATE_REGEX),
  amount: z.union([z.string().trim().min(1), z.number().finite()]),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER"]).default("CASH"),
  referenceNote: z.string().trim().max(500).optional().nullable(),
  idempotencyKey: z.string().trim().min(16).max(64),
});

const expenseSchema = z.object({
  expenseDate: z.string().regex(DATE_REGEX),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().min(3).max(500),
  amount: z.union([z.string().trim().min(1), z.number().finite()]),
  idempotencyKey: z.string().trim().min(16).max(64),
});

function parseIdParam(raw: string | string[] | undefined, label: string): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const num = Number(s);
  if (!Number.isInteger(num) || num <= 0) throw new ValidationError(`Invalid ${label}.`);
  return num;
}

export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  listCompensation = async (_req: Request, res: Response): Promise<void> => {
    const profiles = await this.payrollService.getCompensationProfiles();
    res.status(200).json({ success: true, data: { profiles } });
  };

  upsertCompensation = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = compensationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid compensation profile.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const profile = await this.payrollService.upsertCompensationProfile(parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { profile } });
  };

  listPeriods = async (_req: Request, res: Response): Promise<void> => {
    const periods = await this.payrollService.getPeriods();
    res.status(200).json({ success: true, data: { periods } });
  };

  createPeriod = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = createPeriodSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid payroll period.");
    }
    const period = await this.payrollService.createPeriod(parsed.data, {
      ownerUserId: req.auth.user.id,
    });
    res.status(201).json({ success: true, data: { period } });
  };

  preparePeriod = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const periodId = parseIdParam(req.params.id, "period id");
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const entries = await this.payrollService.preparePeriodDrafts(periodId, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { entries } });
  };

  listPeriodEntries = async (req: Request, res: Response): Promise<void> => {
    const periodId = parseIdParam(req.params.id, "period id");
    const entries = await this.payrollService.getEntriesForPeriod(periodId);
    res.status(200).json({ success: true, data: { entries } });
  };

  updateDraftEntry = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const entryId = parseIdParam(req.params.id, "payroll entry id");
    const parsed = updateEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid entry update.");
    }
    const { expectedVersion, ...rest } = parsed.data;
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const entry = await this.payrollService.updateDraftEntry(entryId, expectedVersion, rest, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { entry } });
  };

  approveEntry = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const entryId = parseIdParam(req.params.id, "payroll entry id");
    const parsed = versionSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("expectedVersion is required.");
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const entry = await this.payrollService.approvePayrollEntry(
      entryId,
      parsed.data.expectedVersion,
      { ownerUserId: req.auth.user.id, ipAddress }
    );
    res.status(200).json({ success: true, data: { entry } });
  };

  listAdvances = async (req: Request, res: Response): Promise<void> => {
    const workerId = typeof req.query.workerId === "string" ? Number(req.query.workerId) : undefined;
    const advances = await this.payrollService.getAdvances(
      Number.isInteger(workerId) && workerId! > 0 ? workerId : undefined
    );
    res.status(200).json({ success: true, data: { advances } });
  };

  recordAdvance = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = advanceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid advance payload.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const result = await this.payrollService.recordAdvance(parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(201).json({ success: true, data: result });
  };

  listSalaryPayments = async (req: Request, res: Response): Promise<void> => {
    const periodId = typeof req.query.periodId === "string" ? Number(req.query.periodId) : undefined;
    const workerId = typeof req.query.workerId === "string" ? Number(req.query.workerId) : undefined;
    const payments = await this.payrollService.getSalaryPayments({
      periodId: Number.isInteger(periodId) && periodId! > 0 ? periodId : undefined,
      workerId: Number.isInteger(workerId) && workerId! > 0 ? workerId : undefined,
    });
    res.status(200).json({ success: true, data: { payments } });
  };

  recordSalaryPayment = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const entryId = parseIdParam(req.params.id, "payroll entry id");
    const parsed = salaryPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid salary payment.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const result = await this.payrollService.recordSalaryPayment(
      { ...parsed.data, payrollEntryId: entryId },
      { ownerUserId: req.auth.user.id, ipAddress }
    );
    res.status(201).json({ success: true, data: result });
  };

  listExpenses = async (req: Request, res: Response): Promise<void> => {
    const dateFrom = typeof req.query.dateFrom === "string" && DATE_REGEX.test(req.query.dateFrom) ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" && DATE_REGEX.test(req.query.dateTo) ? req.query.dateTo : undefined;
    const expenses = await this.payrollService.getExpenses({ dateFrom, dateTo });
    res.status(200).json({ success: true, data: { expenses } });
  };

  recordExpense = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = expenseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid expense payload.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const result = await this.payrollService.recordExpense(parsed.data, {
      ownerUserId: req.auth.user.id,
      ipAddress,
    });
    res.status(201).json({ success: true, data: result });
  };
}

