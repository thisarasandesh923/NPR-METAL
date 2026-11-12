import type { OperationalApprovalStatus } from "../approvals/approvals.repository.js";

export interface MachineDto {
  id: number;
  machineCode: string;
  machineName: string;
  machineType: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface MachineWorkLogDto {
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

export interface MachineWorkLogInput {
  workDate: string;
  machineId: number;
  operatorWorkerId?: number | null;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  downtimeMinutes: number;
  downtimeReason?: string | null;
  scheduledHours?: string | number | null;
  remarks?: string | null;
}

