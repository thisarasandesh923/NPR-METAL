import type { OperationalApprovalStatus } from "../approvals/approvals.repository.js";

export interface ProductionLogDto {
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

export interface ProductionLogInput {
  productionDate: string;
  materialId: number;
  machineId?: number | null;
  operatorWorkerId?: number | null;
  shiftLabel?: string | null;
  quantityProduced: string | number;
  remarks?: string | null;
}

