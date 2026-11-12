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
  version: number;
  updatedAt: string;
}

export interface PayrollPeriodDto {
  id: number;
  periodLabel: string;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "APPROVED" | "CLOSED";
  notes: string | null;
  version: number;
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
  createdAt: string;
}

export interface SalaryPaymentDto {
  id: number;
  salaryReceiptNumber: string;
  payrollEntryId: number;
  workerId: number;
  workerName: string;
  paymentDate: string;
  amount: string;
  paymentMethod: "CASH" | "BANK_TRANSFER";
  referenceNote: string | null;
  createdAt: string;
}

export interface OperationalExpenseDto {
  id: number;
  expenseNumber: string;
  expenseDate: string;
  category: string;
  description: string;
  amount: string;
  createdAt: string;
}

