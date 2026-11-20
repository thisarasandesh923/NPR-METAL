export type PayArrangement = "HOURLY" | "DAILY" | "MONTHLY" | "MANUAL";
export type CalculationMode = "CONFIGURED_AUTO" | "OWNER_MANUAL_DRAFT";

export interface CompensationProfileDto {
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
  updatedByUserId?: string;
  updatedByUsername?: string;
  updatedByName?: string;
  updatedByRole?: string;
  version: number;
  updatedAt: string;
}

export interface CompensationHistoryDto {
  id: number;
  workerId: number;
  workerCode: string;
  workerName: string;
  oldPayArrangement: PayArrangement | null;
  newPayArrangement: PayArrangement;
  oldBaseRate: string | null;
  newBaseRate: string | null;
  oldOvertimeHourlyRate: string | null;
  newOvertimeHourlyRate: string | null;
  changedByUserId: string;
  changedByUsername: string;
  changedByName: string;
  changedByRole: string;
  reason: string;
  effectiveFrom: string;
  createdAt: string;
}

export interface CompensationHistoryFilters {
  workerId?: number;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface PayrollPeriodDto {
  id: number;
  periodLabel: string;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "APPROVED" | "CLOSED";
  notes: string | null;
  version: number;
  createdByUserId?: string;
  createdByUsername?: string;
  createdByName?: string;
  createdByRole?: string;
  approvedByUserId?: string;
  approvedByUsername?: string;
  approvedByName?: string;
  approvedByRole?: string;
  approvedAt?: string | null;
  createdAt: string;
}

export interface PayrollEntryDto {
  id: number;
  payrollPeriodId: number;
  workerId: number;
  workerCode: string;
  workerName: string;
  designation: string;
  payArrangementSnapshot: PayArrangement;
  calculationMode: CalculationMode;
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

export interface WorkerAdvanceDto {
  id: number;
  advanceNumber: string;
  workerId: number;
  workerCode: string;
  workerName: string;
  advanceDate: string;
  amount: string;
  reason: string;
  authorizedByUserId?: string;
  authorizedByUsername?: string;
  authorizedByName?: string;
  authorizedByRole?: string;
  createdAt: string;
}

export interface WorkerAdvanceFilters {
  workerId?: number;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface SalaryPaymentDto {
  id: number;
  salaryReceiptNumber: string;
  payrollEntryId: number;
  workerId: number;
  workerName: string;
  paymentDate: string;
  amount: string;
  effectiveAmount?: string;
  paymentMethod: "CASH" | "BANK_TRANSFER";
  referenceNote: string | null;
  paidByOwnerId?: string;
  paidByOwnerUsername?: string;
  paidByOwnerName?: string;
  paidByOwnerRole?: string;
  createdAt: string;
}

export interface OperationalExpenseDto {
  id: number;
  expenseNumber: string;
  expenseDate: string;
  category: string;
  description: string;
  amount: string;
  recordedByUserId?: string;
  recordedByUsername?: string;
  recordedByName?: string;
  recordedByRole?: string;
  createdAt: string;
}

export interface OperationalExpenseFilters {
  category?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateManualSalaryInput {
  expectedVersion: number;
  grossSalary: string | number;
  reason: string;
  notes?: string | null;
}

export interface SalaryAuditHistoryDto {
  id: number;
  payrollEntryId: number;
  workerId: number;
  workerCode?: string;
  workerName?: string;
  periodId: number;
  periodLabel?: string;
  action: string;
  previousGrossSalary: string | null;
  newGrossSalary: string | null;
  applicableAdvances: string | null;
  calculatedNetPayable: string | null;
  excessAdvances: string | null;
  reason: string;
  notes?: string | null;
  actorUserId: string;
  actorUsername: string;
  actorRole: string;
  createdAt: string;
}

export interface SalaryAuditHistoryFilters {
  entryId?: number;
  workerId?: number;
  periodId?: number;
  limit?: number;
  offset?: number;
}

export type SalaryAdjustmentType = "VOID" | "AMOUNT_CORRECTION";

export interface SalaryPaymentAdjustmentDto {
  id: number;
  adjustmentNumber: string;
  salaryPaymentId: number;
  payrollEntryId: number;
  workerId: number;
  workerName: string;
  adjustmentType: SalaryAdjustmentType;
  priorEffectiveAmount: string;
  correctedAmount: string;
  adjustmentDelta: string;
  authorizedByUserId: string;
  authorizedByUsername?: string;
  authorizedByName?: string;
  authorizedByRole?: string;
  reason: string;
  createdAt: string;
}

export interface AdjustSalaryPaymentInput {
  adjustmentType: SalaryAdjustmentType;
  correctedAmount?: string | number;
  expectedPriorAmount?: string | number;
  reason: string;
  idempotencyKey: string;
}

export interface UpdateApprovedSalaryInput {
  expectedVersion: number;
  newGrossSalary: string | number;
  reason: string;
  notes?: string | null;
}
