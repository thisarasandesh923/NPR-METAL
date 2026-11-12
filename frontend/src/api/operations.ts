import { ApiError, apiRequest } from "./client.ts";
import type { InvoiceDetail, MaterialCatalogItem } from "../types/billing.ts";
import type {
  AttendanceRecord,
  CompensationProfileRecord,
  EmploymentStatus,
  FinancialReportSummary,
  GeneralExportType,
  MachineRecord,
  MachineWorkLogRecord,
  MaterialPriceHistoryRecord,
  OperationalApprovalHistoryItem,
  OperationalApprovalStatus,
  OperationalExpenseRecord,
  OperationsReportSummary,
  PayArrangement,
  PayrollEntryRecord,
  PayrollPeriodRecord,
  PendingApprovalsPayload,
  ProductionLogRecord,
  ReportExportFormat,
  SalaryPaymentRecord,
  WorkerAdvanceRecord,
  WorkerRecord,
} from "../types/operations.ts";

// --- Material Prices ---
export async function updateMaterialPrice(
  materialId: number,
  body: { newPrice: string; reason: string; expectedVersion: number }
): Promise<MaterialCatalogItem> {
  const data = await apiRequest<{ material: MaterialCatalogItem }>(
    `/api/materials/${materialId}/price`,
    { method: "PUT", body }
  );
  return data.material;
}

export async function fetchMaterialPriceHistory(
  materialId?: number
): Promise<MaterialPriceHistoryRecord[]> {
  const qs = materialId !== undefined ? `?materialId=${materialId}` : "";
  const data = await apiRequest<{ history: MaterialPriceHistoryRecord[] }>(
    `/api/materials/price-history${qs}`
  );
  return data.history;
}

// --- Workers & Attendance ---
export async function fetchWorkers(includeInactive = true): Promise<WorkerRecord[]> {
  const data = await apiRequest<{ workers: WorkerRecord[] }>(
    `/api/workers?includeInactive=${includeInactive ? "true" : "false"}`
  );
  return data.workers;
}

export async function createWorker(body: {
  workerCode: string;
  fullName: string;
  phone?: string | null;
  designation: string;
  joinedDate?: string | null;
  employmentStatus?: EmploymentStatus;
  notes?: string | null;
}): Promise<WorkerRecord> {
  const data = await apiRequest<{ worker: WorkerRecord }>("/api/workers", {
    method: "POST",
    body,
  });
  return data.worker;
}

export async function updateWorker(
  id: number,
  body: {
    fullName: string;
    phone?: string | null;
    designation: string;
    joinedDate?: string | null;
    employmentStatus: EmploymentStatus;
    notes?: string | null;
  }
): Promise<WorkerRecord> {
  const data = await apiRequest<{ worker: WorkerRecord }>(`/api/workers/${id}`, {
    method: "PUT",
    body,
  });
  return data.worker;
}

export async function fetchAttendanceRecords(filters: {
  dateFrom?: string;
  dateTo?: string;
  workerId?: number;
  status?: OperationalApprovalStatus;
}): Promise<AttendanceRecord[]> {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.workerId) params.set("workerId", String(filters.workerId));
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  const data = await apiRequest<{ attendance: AttendanceRecord[] }>(
    `/api/attendance${qs ? `?${qs}` : ""}`
  );
  return data.attendance;
}

export async function createAttendanceDraft(body: {
  workDate: string;
  workerId: number;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  overtimeHours: string;
  remarks?: string | null;
}): Promise<AttendanceRecord> {
  const data = await apiRequest<{ attendance: AttendanceRecord }>("/api/attendance", {
    method: "POST",
    body,
  });
  return data.attendance;
}

export async function updateAttendanceDraft(
  id: number,
  body: {
    workDate: string;
    workerId: number;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
    breakMinutes: number;
    overtimeHours: string;
    remarks?: string | null;
    expectedVersion: number;
  }
): Promise<AttendanceRecord> {
  const data = await apiRequest<{ attendance: AttendanceRecord }>(
    `/api/attendance/${id}`,
    { method: "PUT", body }
  );
  return data.attendance;
}

export async function submitAttendanceDraft(
  id: number,
  expectedVersion: number
): Promise<AttendanceRecord> {
  const data = await apiRequest<{ attendance: AttendanceRecord }>(
    `/api/attendance/${id}/submit`,
    { method: "POST", body: { expectedVersion } }
  );
  return data.attendance;
}

export async function cancelAttendanceDraft(
  id: number,
  expectedVersion: number
): Promise<AttendanceRecord> {
  const data = await apiRequest<{ attendance: AttendanceRecord }>(
    `/api/attendance/${id}/cancel`,
    { method: "POST", body: { expectedVersion } }
  );
  return data.attendance;
}

export async function reviewAttendanceRecord(
  id: number,
  body: {
    decision: "APPROVED" | "RETURNED_FOR_CORRECTION";
    reason?: string | null;
    expectedVersion: number;
  }
): Promise<AttendanceRecord> {
  const data = await apiRequest<{ attendance: AttendanceRecord }>(
    `/api/attendance/${id}/review`,
    { method: "POST", body }
  );
  return data.attendance;
}

// --- Machines & Machine Work Logs ---
export async function fetchMachines(includeInactive = true): Promise<MachineRecord[]> {
  const data = await apiRequest<{ machines: MachineRecord[] }>(
    `/api/machines?includeInactive=${includeInactive ? "true" : "false"}`
  );
  return data.machines;
}

export async function createMachine(body: {
  machineCode: string;
  machineName: string;
  machineType: string;
  description?: string | null;
  isActive?: boolean;
}): Promise<MachineRecord> {
  const data = await apiRequest<{ machine: MachineRecord }>("/api/machines", {
    method: "POST",
    body,
  });
  return data.machine;
}

export async function updateMachine(
  id: number,
  body: {
    machineName: string;
    machineType: string;
    description?: string | null;
    isActive: boolean;
  }
): Promise<MachineRecord> {
  const data = await apiRequest<{ machine: MachineRecord }>(`/api/machines/${id}`, {
    method: "PUT",
    body,
  });
  return data.machine;
}

export async function fetchMachineLogs(filters: {
  dateFrom?: string;
  dateTo?: string;
  machineId?: number;
  status?: OperationalApprovalStatus;
}): Promise<MachineWorkLogRecord[]> {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.machineId) params.set("machineId", String(filters.machineId));
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  const data = await apiRequest<{ machineLogs: MachineWorkLogRecord[] }>(
    `/api/machine-logs${qs ? `?${qs}` : ""}`
  );
  return data.machineLogs;
}

export async function createMachineLogDraft(body: {
  workDate: string;
  machineId: number;
  operatorWorkerId?: number | null;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  downtimeMinutes: number;
  downtimeReason?: string | null;
  scheduledHours?: string | null;
  remarks?: string | null;
}): Promise<MachineWorkLogRecord> {
  const data = await apiRequest<{ machineLog: MachineWorkLogRecord }>(
    "/api/machine-logs",
    { method: "POST", body }
  );
  return data.machineLog;
}

export async function updateMachineLogDraft(
  id: number,
  body: {
    workDate: string;
    machineId: number;
    operatorWorkerId?: number | null;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
    downtimeMinutes: number;
    downtimeReason?: string | null;
    scheduledHours?: string | null;
    remarks?: string | null;
    expectedVersion: number;
  }
): Promise<MachineWorkLogRecord> {
  const data = await apiRequest<{ machineLog: MachineWorkLogRecord }>(
    `/api/machine-logs/${id}`,
    { method: "PUT", body }
  );
  return data.machineLog;
}

export async function submitMachineLogDraft(
  id: number,
  expectedVersion: number
): Promise<MachineWorkLogRecord> {
  const data = await apiRequest<{ machineLog: MachineWorkLogRecord }>(
    `/api/machine-logs/${id}/submit`,
    { method: "POST", body: { expectedVersion } }
  );
  return data.machineLog;
}

export async function cancelMachineLogDraft(
  id: number,
  expectedVersion: number
): Promise<MachineWorkLogRecord> {
  const data = await apiRequest<{ machineLog: MachineWorkLogRecord }>(
    `/api/machine-logs/${id}/cancel`,
    { method: "POST", body: { expectedVersion } }
  );
  return data.machineLog;
}

export async function reviewMachineLogRecord(
  id: number,
  body: {
    decision: "APPROVED" | "RETURNED_FOR_CORRECTION";
    reason?: string | null;
    expectedVersion: number;
  }
): Promise<MachineWorkLogRecord> {
  const data = await apiRequest<{ machineLog: MachineWorkLogRecord }>(
    `/api/machine-logs/${id}/review`,
    { method: "POST", body }
  );
  return data.machineLog;
}

// --- Production Logs ---
export async function fetchProductionLogs(filters: {
  dateFrom?: string;
  dateTo?: string;
  materialId?: number;
  machineId?: number;
  status?: OperationalApprovalStatus;
}): Promise<ProductionLogRecord[]> {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.materialId) params.set("materialId", String(filters.materialId));
  if (filters.machineId) params.set("machineId", String(filters.machineId));
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  const data = await apiRequest<{ productionLogs: ProductionLogRecord[] }>(
    `/api/production${qs ? `?${qs}` : ""}`
  );
  return data.productionLogs;
}

export async function createProductionDraft(body: {
  productionDate: string;
  materialId: number;
  machineId?: number | null;
  operatorWorkerId?: number | null;
  shiftLabel?: string | null;
  quantityProduced: string;
  remarks?: string | null;
}): Promise<ProductionLogRecord> {
  const data = await apiRequest<{ productionLog: ProductionLogRecord }>(
    "/api/production",
    { method: "POST", body }
  );
  return data.productionLog;
}

export async function updateProductionDraft(
  id: number,
  body: {
    productionDate: string;
    materialId: number;
    machineId?: number | null;
    operatorWorkerId?: number | null;
    shiftLabel?: string | null;
    quantityProduced: string;
    remarks?: string | null;
    expectedVersion: number;
  }
): Promise<ProductionLogRecord> {
  const data = await apiRequest<{ productionLog: ProductionLogRecord }>(
    `/api/production/${id}`,
    { method: "PUT", body }
  );
  return data.productionLog;
}

export async function submitProductionDraft(
  id: number,
  expectedVersion: number
): Promise<ProductionLogRecord> {
  const data = await apiRequest<{ productionLog: ProductionLogRecord }>(
    `/api/production/${id}/submit`,
    { method: "POST", body: { expectedVersion } }
  );
  return data.productionLog;
}

export async function cancelProductionDraft(
  id: number,
  expectedVersion: number
): Promise<ProductionLogRecord> {
  const data = await apiRequest<{ productionLog: ProductionLogRecord }>(
    `/api/production/${id}/cancel`,
    { method: "POST", body: { expectedVersion } }
  );
  return data.productionLog;
}

export async function reviewProductionRecord(
  id: number,
  body: {
    decision: "APPROVED" | "RETURNED_FOR_CORRECTION";
    reason?: string | null;
    expectedVersion: number;
  }
): Promise<ProductionLogRecord> {
  const data = await apiRequest<{ productionLog: ProductionLogRecord }>(
    `/api/production/${id}/review`,
    { method: "POST", body }
  );
  return data.productionLog;
}

// --- Approvals Queue & History ---
export async function fetchPendingApprovals(): Promise<PendingApprovalsPayload> {
  return apiRequest<PendingApprovalsPayload>("/api/approvals/pending");
}

export async function fetchOperationalApprovalHistory(
  recordType: "ATTENDANCE" | "MACHINE_LOG" | "PRODUCTION_LOG",
  recordId: number
): Promise<OperationalApprovalHistoryItem[]> {
  const data = await apiRequest<{ history: OperationalApprovalHistoryItem[] }>(
    `/api/approvals/history?recordType=${recordType}&recordId=${recordId}`
  );
  return data.history;
}

// --- OWNER Reports & Exports ---
export async function fetchFinancialReport(
  dateFrom: string,
  dateTo: string
): Promise<FinancialReportSummary> {
  const data = await apiRequest<{ financial: FinancialReportSummary }>(
    `/api/reports/financial?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`
  );
  return data.financial;
}

export async function fetchOperationsReport(
  dateFrom: string,
  dateTo: string
): Promise<OperationsReportSummary> {
  const data = await apiRequest<{ operations: OperationsReportSummary }>(
    `/api/reports/operations?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`
  );
  return data.operations;
}

async function triggerProtectedDownload(
  url: string,
  fallbackFilename: string
): Promise<void> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      "DOWNLOAD_FAILED",
      `Export failed with status ${response.status}.`
    );
  }
  const blob = await response.blob();
  const disp = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/i.exec(disp);
  const filename = match?.[1] || fallbackFilename;

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function downloadGeneralReportExport(params: {
  type: GeneralExportType;
  format: ReportExportFormat;
  dateFrom: string;
  dateTo: string;
}): Promise<void> {
  const qs = new URLSearchParams({
    type: params.type,
    format: params.format,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  }).toString();
  await triggerProtectedDownload(
    `/api/reports/export?${qs}`,
    `npr-${params.type}.${params.format}`
  );
}

export async function downloadPayrollExport(params: {
  format: ReportExportFormat;
  dateFrom?: string;
  dateTo?: string;
  periodId?: number;
}): Promise<void> {
  const sp = new URLSearchParams({ format: params.format });
  if (params.periodId !== undefined) sp.set("periodId", String(params.periodId));
  if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
  if (params.dateTo) sp.set("dateTo", params.dateTo);
  await triggerProtectedDownload(
    `/api/reports/export/payroll?${sp.toString()}`,
    `npr-payroll.${params.format}`
  );
}

// --- OWNER Payroll, Advances & Operational Expenses ---
export async function fetchCompensationProfiles(): Promise<
  CompensationProfileRecord[]
> {
  const data = await apiRequest<{ profiles: CompensationProfileRecord[] }>(
    "/api/payroll/compensation"
  );
  return data.profiles;
}

export async function upsertCompensationProfile(body: {
  workerId: number;
  payArrangement: PayArrangement;
  baseRate: string | null;
  overtimeHourlyRate: string | null;
  effectiveFrom: string;
  notes?: string | null;
}): Promise<CompensationProfileRecord> {
  const data = await apiRequest<{ profile: CompensationProfileRecord }>(
    "/api/payroll/compensation",
    { method: "PUT", body }
  );
  return data.profile;
}

export async function fetchPayrollPeriods(): Promise<PayrollPeriodRecord[]> {
  const data = await apiRequest<{ periods: PayrollPeriodRecord[] }>(
    "/api/payroll/periods"
  );
  return data.periods;
}

export async function createPayrollPeriod(body: {
  periodLabel: string;
  startDate: string;
  endDate: string;
  notes?: string | null;
}): Promise<PayrollPeriodRecord> {
  const data = await apiRequest<{ period: PayrollPeriodRecord }>(
    "/api/payroll/periods",
    { method: "POST", body }
  );
  return data.period;
}

export async function preparePayrollPeriod(
  periodId: number
): Promise<PayrollEntryRecord[]> {
  const data = await apiRequest<{ entries: PayrollEntryRecord[] }>(
    `/api/payroll/periods/${periodId}/prepare`,
    { method: "POST", body: {} }
  );
  return data.entries;
}

export async function fetchPayrollPeriodEntries(
  periodId: number
): Promise<PayrollEntryRecord[]> {
  const data = await apiRequest<{ entries: PayrollEntryRecord[] }>(
    `/api/payroll/periods/${periodId}/entries`
  );
  return data.entries;
}

export async function updatePayrollDraftEntry(
  entryId: number,
  body: {
    expectedVersion: number;
    basePay: string;
    overtimePay: string;
    allowances: string;
    deductions: string;
    advanceDeduction: string;
    notes?: string | null;
  }
): Promise<PayrollEntryRecord> {
  const data = await apiRequest<{ entry: PayrollEntryRecord }>(
    `/api/payroll/entries/${entryId}`,
    { method: "PUT", body }
  );
  return data.entry;
}

export async function approvePayrollEntry(
  entryId: number,
  expectedVersion: number
): Promise<PayrollEntryRecord> {
  const data = await apiRequest<{ entry: PayrollEntryRecord }>(
    `/api/payroll/entries/${entryId}/approve`,
    { method: "POST", body: { expectedVersion } }
  );
  return data.entry;
}

export async function recordSalaryPayment(
  entryId: number,
  body: {
    paymentDate: string;
    amount: string;
    paymentMethod: "CASH" | "BANK_TRANSFER";
    referenceNote?: string | null;
    idempotencyKey: string;
  }
): Promise<{ payment: SalaryPaymentRecord; entry: PayrollEntryRecord }> {
  return apiRequest<{ payment: SalaryPaymentRecord; entry: PayrollEntryRecord }>(
    `/api/payroll/entries/${entryId}/payments`,
    { method: "POST", body }
  );
}

export async function fetchWorkerAdvances(
  workerId?: number
): Promise<WorkerAdvanceRecord[]> {
  const qs = workerId ? `?workerId=${workerId}` : "";
  const data = await apiRequest<{ advances: WorkerAdvanceRecord[] }>(
    `/api/payroll/advances${qs}`
  );
  return data.advances;
}

export async function recordWorkerAdvance(body: {
  workerId: number;
  advanceDate: string;
  amount: string;
  reason: string;
  idempotencyKey: string;
}): Promise<WorkerAdvanceRecord> {
  const data = await apiRequest<{ advance: WorkerAdvanceRecord }>(
    "/api/payroll/advances",
    { method: "POST", body }
  );
  return data.advance;
}

export async function fetchSalaryPayments(): Promise<SalaryPaymentRecord[]> {
  const data = await apiRequest<{ payments: SalaryPaymentRecord[] }>(
    "/api/payroll/payments"
  );
  return data.payments;
}

export async function fetchOperationalExpenses(
  dateFrom?: string,
  dateTo?: string
): Promise<OperationalExpenseRecord[]> {
  const sp = new URLSearchParams();
  if (dateFrom) sp.set("dateFrom", dateFrom);
  if (dateTo) sp.set("dateTo", dateTo);
  const qs = sp.toString();
  const data = await apiRequest<{ expenses: OperationalExpenseRecord[] }>(
    `/api/expenses${qs ? `?${qs}` : ""}`
  );
  return data.expenses;
}

export async function recordOperationalExpense(body: {
  expenseDate: string;
  category: string;
  description: string;
  amount: string;
  idempotencyKey: string;
}): Promise<OperationalExpenseRecord> {
  const data = await apiRequest<{ expense: OperationalExpenseRecord }>(
    "/api/expenses",
    { method: "POST", body }
  );
  return data.expense;
}

// --- OWNER Payment Entry Reversal ---
export async function reversePaymentEntry(
  paymentId: number,
  body: {
    adjustmentType: "ENTRY_REVERSAL";
    amount: string;
    reason: string;
    idempotencyKey: string;
  }
): Promise<{ invoice: InvoiceDetail }> {
  return apiRequest<{ invoice: InvoiceDetail }>(
    `/api/payments/${paymentId}/adjust`,
    { method: "POST", body }
  );
}

