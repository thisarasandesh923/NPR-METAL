import type { OperationalApprovalStatus } from "../approvals/approvals.repository.js";

export type EmploymentStatus = "ACTIVE" | "INACTIVE" | "ON_LEAVE";

export interface WorkerDto {
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

export interface WorkerAttendanceDto {
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

export interface AttendanceInput {
  workDate: string;
  workerId: number;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  overtimeHours: string | number;
  remarks?: string | null;
}

