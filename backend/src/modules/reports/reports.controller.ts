import type { Request, Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../errors/appError.js";
import type { ExportFormat } from "../../utils/exports.js";
import type { GeneralReportExportType } from "./reports.exports.js";
import type { ReportsService } from "./reports.service.js";

const rangeSchema = z.object({
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

const generalExportQuerySchema = z.object({
  type: z.enum([
    "invoices",
    "collections",
    "outstanding",
    "attendance",
    "machines",
    "production",
    "summary",
  ]),
  format: z.enum(["csv", "xlsx", "pdf"]),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

const payrollExportQuerySchema = z.object({
  format: z.enum(["csv", "xlsx", "pdf"]),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  periodId: z.coerce.number().int().positive().optional(),
});

export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  overview = async (_req: Request, res: Response): Promise<void> => {
    const overview = await this.reportsService.getOverview();
    res.status(200).json({
      success: true,
      data: { overview },
    });
  };

  financial = async (req: Request, res: Response): Promise<void> => {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid report date range parameters.");
    }
    const financial = await this.reportsService.getFinancialReport(
      parsed.data.dateFrom,
      parsed.data.dateTo
    );
    res.status(200).json({
      success: true,
      data: { financial },
    });
  };

  operations = async (req: Request, res: Response): Promise<void> => {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid report date range parameters.");
    }
    const operations = await this.reportsService.getOperationsReport(
      parsed.data.dateFrom,
      parsed.data.dateTo
    );
    res.status(200).json({
      success: true,
      data: { operations },
    });
  };

  exportGeneral = async (req: Request, res: Response): Promise<void> => {
    if (req.query.type === "payroll") {
      throw new ValidationError(
        "Payroll exports must use the dedicated OWNER-only /api/reports/export/payroll endpoint."
      );
    }
    const parsed = generalExportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid export parameters."
      );
    }
    const result = await this.reportsService.exportGeneralReport({
      type: parsed.data.type as GeneralReportExportType,
      format: parsed.data.format as ExportFormat,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
    });
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );
    res.status(200).send(result.buffer);
  };

  exportPayroll = async (req: Request, res: Response): Promise<void> => {
    const parsed = payrollExportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid payroll export parameters."
      );
    }
    const result = await this.reportsService.exportPayrollReport({
      format: parsed.data.format as ExportFormat,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      periodId: parsed.data.periodId,
    });
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );
    res.status(200).send(result.buffer);
  };
}
