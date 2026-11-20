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
  reason: z.string().trim().min(5, "Business reason must be at least 5 characters.").max(500),
  expectedVersion: z.number().int().positive().optional(),
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

const updateManualSalarySchema = z.object({
  expectedVersion: z.number().int().positive(),
  grossSalary: z.union([z.string().trim().min(1), z.number().finite()]),
  reason: z.string().trim().min(5, "Business reason must be at least 5 characters.").max(500),
  notes: z.string().trim().max(500).optional().nullable(),
});

const updateApprovedSalarySchema = z.object({
  expectedVersion: z.number().int().positive(),
  newGrossSalary: z.union([z.string().trim().min(1), z.number().finite()]),
  reason: z.string().trim().min(5, "Business reason must be at least 5 characters.").max(500),
  notes: z.string().trim().max(500).optional().nullable(),
});

const adjustSalaryPaymentSchema = z.object({
  adjustmentType: z.enum(["AMOUNT_CORRECTION", "VOID"]),
  correctedAmount: z.union([z.string().trim().min(1), z.number().finite()]).optional(),
  expectedPriorAmount: z.union([z.string().trim().min(1), z.number().finite()]).optional(),
  reason: z.string().trim().min(10, "Business reason must be at least 10 characters.").max(500),
  idempotencyKey: z.string().trim().min(16, "Idempotency key must be at least 16 characters.").max(64),
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
  paymentMethod: z.literal("CASH").default("CASH"),
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
      userId: req.auth.user.id,
      username: req.auth.user.username,
      role: req.auth.user.role,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { profile } });
  };

  listCompensationHistory = async (req: Request, res: Response): Promise<void> => {
    const workerId = typeof req.query.workerId === "string" ? Number(req.query.workerId) : undefined;
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" && DATE_REGEX.test(req.query.dateFrom) ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" && DATE_REGEX.test(req.query.dateTo) ? req.query.dateTo : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const offset = typeof req.query.offset === "string" ? Number(req.query.offset) : undefined;

    const history = await this.payrollService.getCompensationHistory({
      workerId: Number.isInteger(workerId) && workerId! > 0 ? workerId : undefined,
      userId,
      dateFrom,
      dateTo,
      limit: Number.isInteger(limit) && limit! > 0 ? limit : undefined,
      offset: Number.isInteger(offset) && offset! >= 0 ? offset : undefined,
    });
    res.status(200).json({ success: true, data: { history } });
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
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const period = await this.payrollService.createPeriod(parsed.data, {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      role: req.auth.user.role,
      fullName: req.auth.user.fullName,
      ipAddress,
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

  initializeManualPeriod = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const periodId = parseIdParam(req.params.id, "period id");
    const entries = await this.payrollService.initializeManualPeriodDrafts(periodId, {
      userId: req.auth.user.id,
    });
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

  updateManualSalary = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const entryId = parseIdParam(req.params.id, "payroll entry id");
    const parsed = updateManualSalarySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid manual salary update.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const entry = await this.payrollService.updateManualSalary(entryId, parsed.data, {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      role: req.auth.user.role,
      fullName: req.auth.user.fullName,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { entry } });
  };

  updateApprovedSalary = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const entryId = parseIdParam(req.params.id, "payroll entry id");
    const parsed = updateApprovedSalarySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid approved salary update.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const entry = await this.payrollService.updateApprovedSalary(entryId, parsed.data, {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      role: req.auth.user.role,
      fullName: req.auth.user.fullName,
      ipAddress,
    });
    res.status(200).json({ success: true, data: { entry } });
  };

  listSalaryAuditHistory = async (req: Request, res: Response): Promise<void> => {
    const entryId = typeof req.query.entryId === "string" ? Number(req.query.entryId) : (req.params.id ? Number(req.params.id) : undefined);
    const workerId = typeof req.query.workerId === "string" ? Number(req.query.workerId) : undefined;
    const periodId = typeof req.query.periodId === "string" ? Number(req.query.periodId) : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const offset = typeof req.query.offset === "string" ? Number(req.query.offset) : undefined;

    const history = await this.payrollService.getSalaryAuditHistory({
      entryId: Number.isInteger(entryId) && entryId! > 0 ? entryId : undefined,
      workerId: Number.isInteger(workerId) && workerId! > 0 ? workerId : undefined,
      periodId: Number.isInteger(periodId) && periodId! > 0 ? periodId : undefined,
      limit: Number.isInteger(limit) && limit! > 0 ? limit : undefined,
      offset: Number.isInteger(offset) && offset! >= 0 ? offset : undefined,
    });
    res.status(200).json({ success: true, data: { history } });
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
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" && DATE_REGEX.test(req.query.dateFrom) ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" && DATE_REGEX.test(req.query.dateTo) ? req.query.dateTo : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const offset = typeof req.query.offset === "string" ? Number(req.query.offset) : undefined;

    const advances = await this.payrollService.getAdvances({
      workerId: Number.isInteger(workerId) && workerId! > 0 ? workerId : undefined,
      userId,
      dateFrom,
      dateTo,
      limit: Number.isInteger(limit) && limit! > 0 ? limit : undefined,
      offset: Number.isInteger(offset) && offset! >= 0 ? offset : undefined,
    });
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
      userId: req.auth.user.id,
      username: req.auth.user.username,
      role: req.auth.user.role,
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
      {
        userId: req.auth.user.id,
        username: req.auth.user.username,
        role: req.auth.user.role,
        fullName: req.auth.user.fullName,
        ipAddress,
      }
    );
    res.status(201).json({ success: true, data: result });
  };

  adjustSalaryPayment = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    const paymentId = parseIdParam(req.params.id, "salary payment id");
    const parsed = adjustSalaryPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid salary payment adjustment.");
    }
    const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 45);
    const result = await this.payrollService.adjustSalaryPayment(paymentId, parsed.data, {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      role: req.auth.user.role,
      fullName: req.auth.user.fullName,
      ipAddress,
    });
    res.status(201).json({ success: true, data: result });
  };

  listPaymentAdjustments = async (req: Request, res: Response): Promise<void> => {
    const paymentId = parseIdParam(req.params.id, "salary payment id");
    const adjustments = await this.payrollService.getSalaryPaymentAdjustments(paymentId);
    res.status(200).json({ success: true, data: { adjustments } });
  };

  listExpenses = async (req: Request, res: Response): Promise<void> => {
    const category = typeof req.query.category === "string" ? req.query.category.trim() : undefined;
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" && DATE_REGEX.test(req.query.dateFrom) ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" && DATE_REGEX.test(req.query.dateTo) ? req.query.dateTo : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const offset = typeof req.query.offset === "string" ? Number(req.query.offset) : undefined;

    const expenses = await this.payrollService.getExpenses({
      category: category || undefined,
      userId,
      dateFrom,
      dateTo,
      limit: Number.isInteger(limit) && limit! > 0 ? limit : undefined,
      offset: Number.isInteger(offset) && offset! >= 0 ? offset : undefined,
    });
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
      userId: req.auth.user.id,
      username: req.auth.user.username,
      role: req.auth.user.role,
      ipAddress,
    });
    res.status(201).json({ success: true, data: result });
  };
}

