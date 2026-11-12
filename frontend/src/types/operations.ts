export type OperationalApprovalStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "RETURNED_FOR_CORRECTION"
  | "CANCELLED";

export type EmploymentStatus = "ACTIVE" | "INACTIVE" | "ON_LEAVE";

export interface MaterialPriceHistoryRecord {
  id: number;
  materialId: number;
  materialCode: string;
  materialName: string;
  oldPrice: string;
  newPrice: string;
  changedByOwnerId: string;
  changedByOwnerName: string;
  reason: string;
  effectiveAt: string;
}

export interface WorkerRecord {
  id: number;
  workerCode: string;
  fullName: string;
  phone: string | null;
  designation: string;
  joinedDate: string | null;
  employmentStatus: EmploymentStatus;
  notes: string | null;
  createdAt: string;
}

export interface AttendanceRecord {
  id: number;
  workDate: string;
  workerId: number;
  workerCode: string;
  workerName: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  hoursWorked: string;
  overtimeHours: string;
  remarks: string | null;
  enteredByUserId: string;
  enteredByName: string;
  approvalStatus: OperationalApprovalStatus;
  version: number;
  submittedAt: string | null;
  reviewedByOwnerId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  updatedAt: string;
}

export interface MachineRecord {
  id: number;
  machineCode: string;
  machineName: string;
  machineType: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface MachineWorkLogRecord {
  id: number;
  workDate: string;
  machineId: number;
  machineCode: string;
  machineName: string;
  machineType: string;
  operatorWorkerId: number | null;
  operatorWorkerName: string | null;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  downtimeMinutes: number;
  downtimeReason: string | null;
  netOperatingHours: string;
  scheduledHours: string | null;
  utilizationPercent: string | null;
  remarks: string | null;
  enteredByUserId: string;
  enteredByName: string;
  approvalStatus: OperationalApprovalStatus;
  version: number;
  submittedAt: string | null;
  reviewedByOwnerId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  updatedAt: string;
}

export interface ProductionLogRecord {
  id: number;
  productionDate: string;
  materialId: number;
  materialCode: string;
  materialName: string;
  machineId: number | null;
  machineName: string | null;
  operatorWorkerId: number | null;
  operatorWorkerName: string | null;
  shiftLabel: string | null;
  quantityProduced: string;
  unit: string;
  remarks: string | null;
  enteredByUserId: string;
  enteredByName: string;
  approvalStatus: OperationalApprovalStatus;
  version: number;
  submittedAt: string | null;
  reviewedByOwnerId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  updatedAt: string;
}

export interface OperationalApprovalHistoryItem {
  id: number;
  recordType: "ATTENDANCE" | "MACHINE_LOG" | "PRODUCTION_LOG";
  recordId: number;
  action:
    | "CREATED"
    | "UPDATED_DRAFT"
    | "SUBMITTED"
    | "APPROVED"
    | "RETURNED_FOR_CORRECTION"
    | "CANCELLED";
  fromStatus: OperationalApprovalStatus | null;
  toStatus: OperationalApprovalStatus;
  actorUserId: string;
  actorName: string;
  reason: string | null;
  snapshot: Record<string, unknown>;
  createdAt: string;
}

export interface PendingApprovalsPayload {
  attendance: AttendanceRecord[];
  machineLogs: MachineWorkLogRecord[];
  productionLogs: ProductionLogRecord[];
}

export type PayArrangement = "HOURLY" | "DAILY" | "MONTHLY" | "MANUAL";

export interface CompensationProfileRecord {
  id: number;
  workerId: number;
  workerCode: string;
  workerName: string;
  designation: string;
  payArrangement: PayArrangement;
  baseRate: string | null;
  overtimeHourlyRate: string | null;
  effectiveFrom: string;
  notes: string | null;
  version: number;
  updatedAt: string;
}

export interface PayrollPeriodRecord {
  id: number;
  periodLabel: string;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "APPROVED" | "CLOSED";
  notes: string | null;
  version: number;
  createdAt: string;
}

export interface PayrollEntryRecord {
  id: number;
  payrollPeriodId: number;
  workerId: number;
  workerCode: string;
  workerName: string;
  designation: string;
  payArrangementSnapshot: PayArrangement;
  calculationMode: "CONFIGURED_AUTO" | "OWNER_MANUAL_DRAFT";
  approvedDaysCount: number;
  approvedRegularHours: string;
  approvedOvertimeHours: string;
  basePay: string;
  overtimePay: string;
  allowances: string;
  deductions: string;
  advanceDeduction: string;
  grossPay: string;
  netPayable: string;
  paidAmount: string;
  remainingPayable: string;
  status: "DRAFT" | "APPROVED" | "CANCELLED";
  notes: string | null;
  version: number;
  approvedAt: string | null;
}

export interface WorkerAdvanceRecord {
  id: number;
  advanceNumber: string;
  workerId: number;
  workerCode: string;
  workerName: string;
  advanceDate: string;
  amount: string;
  reason: string;
  authorizedByOwnerName: string;
  createdAt: string;
}

export interface SalaryPaymentRecord {
  id: number;
  salaryReceiptNumber: string;
  payrollEntryId: number;
  periodLabel: string;
  workerId: number;
  workerName: string;
  paymentDate: string;
  amount: string;
  paymentMethod: "CASH" | "BANK_TRANSFER";
  referenceNote: string | null;
  paidByOwnerName: string;
  createdAt: string;
}

export interface OperationalExpenseRecord {
  id: number;
  expenseNumber: string;
  expenseDate: string;
  category: string;
  description: string;
  amount: string;
  recordedByOwnerName: string;
  createdAt: string;
}

export interface FinancialReportSummary {
  dateFrom: string;
  dateTo: string;
  billedSalesTotal: string;
  issuedInvoiceCount: number;
  cashCollectedTotal: string;
  receiptCount: number;
  outstandingReceivablesTotal: string;
  openInvoicesCount: number;
  recordedExpensesTotal: string;
  payrollApprovedLiabilityTotal: string;
  payrollCashPaidTotal: string;
  dailySales: Array<{
    businessDate: string;
    invoiceCount: number;
    billedTotal: string;
    cashCollectedTotal: string;
  }>;
  cashierCollections: Array<{
    userId: string;
    fullName: string;
    receiptCount: number;
    physicalCashMovement: string;
  }>;
  expensesBreakdown: Array<{
    category: string;
    totalAmount: string;
    entryCount: number;
  }>;
}

export interface OperationsReportSummary {
  dateFrom: string;
  dateTo: string;
  approvedAttendanceDays: number;
  approvedWorkerHours: string;
  approvedOvertimeHours: string;
  approvedMachineHours: string;
  approvedMachineDowntimeMinutes: number;
  approvedProductionTotalM3: string;
  pendingApprovalCounts: {
    attendance: number;
    machineLogs: number;
    productionLogs: number;
  };
  productionByMaterial: Array<{
    materialId: number;
    materialName: string;
    totalQuantityM3: string;
    entryCount: number;
  }>;
  productionByMachine: Array<{
    machineId: number | null;
    machineName: string;
    totalQuantityM3: string;
    entryCount: number;
  }>;
  machineSummary: Array<{
    machineId: number;
    machineName: string;
    netOperatingHours: string;
    downtimeMinutes: number;
    scheduledHours: string | null;
    utilizationPercent: string | null;
  }>;
}

export type GeneralExportType =
  | "invoices"
  | "collections"
  | "outstanding"
  | "attendance"
  | "machines"
  | "production"
  | "summary";

export type ReportExportFormat = "csv" | "xlsx" | "pdf";

