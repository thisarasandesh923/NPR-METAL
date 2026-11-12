import type { Pool } from "pg";
import { ValidationError } from "../../errors/appError.js";
import {
  buildCsvBuffer,
  buildPdfBuffer,
  buildXlsxBuffer,
  type ExportFormat,
} from "../../utils/exports.js";
import {
  buildGeneralExportPayload,
  buildPayrollExportPayload,
  type GeneralReportExportType,
} from "./reports.exports.js";
import {
  fetchAttendanceExportRows,
  fetchCollectionsExportRows,
  fetchFinancialReport,
  fetchInvoicesExportRows,
  fetchMachineLogsExportRows,
  fetchOperationsReport,
  fetchOutstandingExportRows,
  fetchOwnerOverviewReport,
  fetchPayrollExportRows,
  fetchProductionExportRows,
  type FinancialReportSummary,
  type OperationsReportSummary,
  type OwnerOverviewReport,
} from "./reports.repository.js";

function colomboTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function validateDateRange(dateFrom?: string, dateTo?: string): {
  dateFrom: string;
  dateTo: string;
} {
  const today = colomboTodayIso();
  const from = dateFrom?.trim() || `${today.slice(0, 7)}-01`;
  const to = dateTo?.trim() || today;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new ValidationError("Dates must be in YYYY-MM-DD format.");
  }
  if (from > to) {
    throw new ValidationError("dateFrom cannot be after dateTo.");
  }
  return { dateFrom: from, dateTo: to };
}

async function renderBuffer(
  format: ExportFormat,
  payload: ReturnType<typeof buildGeneralExportPayload>
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  if (format === "csv") {
    return {
      buffer: buildCsvBuffer(payload),
      mimeType: "text/csv; charset=utf-8",
      filename: `${payload.filenameBase}.csv`,
    };
  }
  if (format === "xlsx") {
    return {
      buffer: await buildXlsxBuffer(payload),
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `${payload.filenameBase}.xlsx`,
    };
  }
  return {
    buffer: await buildPdfBuffer(payload),
    mimeType: "application/pdf",
    filename: `${payload.filenameBase}.pdf`,
  };
}

export class ReportsService {
  constructor(private readonly pool: Pool) {}

  async getOverview(): Promise<OwnerOverviewReport> {
    return fetchOwnerOverviewReport(this.pool);
  }

  async getFinancialReport(
    dateFrom?: string,
    dateTo?: string
  ): Promise<FinancialReportSummary> {
    const range = validateDateRange(dateFrom, dateTo);
    return fetchFinancialReport(this.pool, range.dateFrom, range.dateTo);
  }

  async getOperationsReport(
    dateFrom?: string,
    dateTo?: string
  ): Promise<OperationsReportSummary> {
    const range = validateDateRange(dateFrom, dateTo);
    return fetchOperationsReport(this.pool, range.dateFrom, range.dateTo);
  }

  async exportGeneralReport(params: {
    type: GeneralReportExportType;
    format: ExportFormat;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const range = validateDateRange(params.dateFrom, params.dateTo);

    let payload;
    switch (params.type) {
      case "invoices":
        payload = buildGeneralExportPayload({
          type: "invoices",
          ...range,
          rows: await fetchInvoicesExportRows(this.pool, range.dateFrom, range.dateTo),
        });
        break;
      case "collections":
        payload = buildGeneralExportPayload({
          type: "collections",
          ...range,
          rows: await fetchCollectionsExportRows(this.pool, range.dateFrom, range.dateTo),
        });
        break;
      case "outstanding":
        payload = buildGeneralExportPayload({
          type: "outstanding",
          ...range,
          rows: await fetchOutstandingExportRows(this.pool),
        });
        break;
      case "attendance":
        payload = buildGeneralExportPayload({
          type: "attendance",
          ...range,
          rows: await fetchAttendanceExportRows(this.pool, range.dateFrom, range.dateTo),
        });
        break;
      case "machines":
        payload = buildGeneralExportPayload({
          type: "machines",
          ...range,
          rows: await fetchMachineLogsExportRows(this.pool, range.dateFrom, range.dateTo),
        });
        break;
      case "production":
        payload = buildGeneralExportPayload({
          type: "production",
          ...range,
          rows: await fetchProductionExportRows(this.pool, range.dateFrom, range.dateTo),
        });
        break;
      case "summary": {
        const [financial, operations] = await Promise.all([
          fetchFinancialReport(this.pool, range.dateFrom, range.dateTo),
          fetchOperationsReport(this.pool, range.dateFrom, range.dateTo),
        ]);
        payload = buildGeneralExportPayload({
          type: "summary",
          ...range,
          financial,
          operations,
        });
        break;
      }
    }

    return renderBuffer(params.format, payload);
  }

  async exportPayrollReport(params: {
    format: ExportFormat;
    dateFrom?: string;
    dateTo?: string;
    periodId?: number;
  }): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const range = validateDateRange(params.dateFrom, params.dateTo);
    const rows = await fetchPayrollExportRows(
      this.pool,
      range.dateFrom,
      range.dateTo,
      params.periodId
    );
    const payload = buildPayrollExportPayload({
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      periodId: params.periodId,
      rows,
    });
    return renderBuffer(params.format, payload);
  }
}
