import type { Pool, PoolClient } from "pg";
import type { OperationalApprovalStatus } from "../approvals/approvals.repository.js";
import type { ProductionLogDto } from "./production.types.js";

export type DbClient = Pool | PoolClient;

interface ProductionLogRow {
  id: string | number;
  production_date: Date | string;
  material_id: number;
  material_code: string;
  material_name: string;
  machine_id: number | null;
  machine_name: string | null;
  operator_worker_id: string | number | null;
  operator_worker_name: string | null;
  shift_label: string | null;
  quantity_produced: string;
  unit: string;
  remarks: string | null;
  entered_by_user_id: string;
  entered_by_name: string;
  approval_status: OperationalApprovalStatus;
  version: number;
  submitted_at: Date | null;
  reviewed_by_owner_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: Date | null;
  review_reason: string | null;
  updated_at: Date;
}

function toDateOnly(v: Date | string): string {
  return typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

function mapRow(row: ProductionLogRow): ProductionLogDto {
  return {
    id: Number(row.id),
    productionDate: toDateOnly(row.production_date),
    materialId: row.material_id,
    materialCode: row.material_code,
    materialName: row.material_name,
    machineId: row.machine_id,
    machineName: row.machine_name,
    operatorWorkerId:
      row.operator_worker_id !== null ? Number(row.operator_worker_id) : null,
    operatorWorkerName: row.operator_worker_name,
    shiftLabel: row.shift_label,
    quantityProduced: row.quantity_produced,
    unit: row.unit,
    remarks: row.remarks,
    enteredByUserId: row.entered_by_user_id,
    enteredByName: row.entered_by_name,
    approvalStatus: row.approval_status,
    version: row.version,
    submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
    reviewedByOwnerId: row.reviewed_by_owner_id,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    reviewReason: row.review_reason,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listProductionLogs(
  client: DbClient,
  filters: {
    dateFrom?: string;
    dateTo?: string;
    materialId?: number;
    machineId?: number;
    status?: OperationalApprovalStatus;
    limit?: number;
  }
): Promise<ProductionLogDto[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`p.production_date >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`p.production_date <= $${params.length}::date`);
  }
  if (filters.materialId !== undefined) {
    params.push(filters.materialId);
    conditions.push(`p.material_id = $${params.length}`);
  }
  if (filters.machineId !== undefined) {
    params.push(filters.machineId);
    conditions.push(`p.machine_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`p.approval_status = $${params.length}`);
  }

  params.push(Math.min(Math.max(filters.limit ?? 200, 1), 500));
  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const res = await client.query<ProductionLogRow>(
    `SELECT
       p.id, p.production_date::text AS production_date,
       p.material_id, mat.code AS material_code, mat.name AS material_name,
       p.machine_id, m.machine_name,
       p.operator_worker_id, w.full_name AS operator_worker_name,
       p.shift_label, p.quantity_produced::text AS quantity_produced,
       p.unit, p.remarks, p.entered_by_user_id, eu.full_name AS entered_by_name,
       p.approval_status, p.version, p.submitted_at,
       p.reviewed_by_owner_id, ru.full_name AS reviewed_by_name, p.reviewed_at, p.review_reason,
       p.updated_at
     FROM public.production_logs p
     JOIN public.materials mat ON mat.id = p.material_id
     LEFT JOIN public.machines m ON m.id = p.machine_id
     LEFT JOIN public.workers w ON w.id = p.operator_worker_id
     JOIN public.users eu ON eu.id = p.entered_by_user_id
     LEFT JOIN public.users ru ON ru.id = p.reviewed_by_owner_id
     ${whereSql}
     ORDER BY p.production_date DESC, p.id DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map(mapRow);
}

export async function findProductionLogById(
  client: DbClient,
  id: number,
  forUpdate = false
): Promise<ProductionLogDto | null> {
  const lockClause = forUpdate ? "FOR UPDATE OF p" : "";
  const res = await client.query<ProductionLogRow>(
    `SELECT
       p.id, p.production_date::text AS production_date,
       p.material_id, mat.code AS material_code, mat.name AS material_name,
       p.machine_id, m.machine_name,
       p.operator_worker_id, w.full_name AS operator_worker_name,
       p.shift_label, p.quantity_produced::text AS quantity_produced,
       p.unit, p.remarks, p.entered_by_user_id, eu.full_name AS entered_by_name,
       p.approval_status, p.version, p.submitted_at,
       p.reviewed_by_owner_id, ru.full_name AS reviewed_by_name, p.reviewed_at, p.review_reason,
       p.updated_at
     FROM public.production_logs p
     JOIN public.materials mat ON mat.id = p.material_id
     LEFT JOIN public.machines m ON m.id = p.machine_id
     LEFT JOIN public.workers w ON w.id = p.operator_worker_id
     JOIN public.users eu ON eu.id = p.entered_by_user_id
     LEFT JOIN public.users ru ON ru.id = p.reviewed_by_owner_id
     WHERE p.id = $1
     ${lockClause}`,
    [id]
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export async function insertProductionDraft(
  client: PoolClient,
  params: {
    productionDate: string;
    materialId: number;
    machineId: number | null;
    operatorWorkerId: number | null;
    shiftLabel: string | null;
    quantityProduced: string;
    remarks: string | null;
    enteredByUserId: string;
  }
): Promise<number> {
  const res = await client.query<{ id: string | number }>(
    `INSERT INTO public.production_logs (
       production_date, material_id, machine_id, operator_worker_id,
       shift_label, quantity_produced, unit, remarks,
       entered_by_user_id, approval_status
     ) VALUES ($1::date, $2, $3, $4, $5, $6, 'm³', $7, $8, 'DRAFT')
     RETURNING id`,
    [
      params.productionDate,
      params.materialId,
      params.machineId,
      params.operatorWorkerId,
      params.shiftLabel,
      params.quantityProduced,
      params.remarks,
      params.enteredByUserId,
    ]
  );
  return Number(res.rows[0].id);
}

export async function updateProductionDraftRow(
  client: PoolClient,
  id: number,
  expectedVersion: number,
  params: {
    productionDate: string;
    materialId: number;
    machineId: number | null;
    operatorWorkerId: number | null;
    shiftLabel: string | null;
    quantityProduced: string;
    remarks: string | null;
  }
): Promise<boolean> {
  const res = await client.query(
    `UPDATE public.production_logs
     SET production_date = $1::date,
         material_id = $2,
         machine_id = $3,
         operator_worker_id = $4,
         shift_label = $5,
         quantity_produced = $6,
         remarks = $7,
         approval_status = 'DRAFT',
         review_reason = NULL
     WHERE id = $8 AND version = $9 AND approval_status IN ('DRAFT', 'RETURNED_FOR_CORRECTION')`,
    [
      params.productionDate,
      params.materialId,
      params.machineId,
      params.operatorWorkerId,
      params.shiftLabel,
      params.quantityProduced,
      params.remarks,
      id,
      expectedVersion,
    ]
  );
  return (res.rowCount ?? 0) === 1;
}

export async function transitionProductionStatus(
  client: PoolClient,
  params: {
    id: number;
    expectedVersion: number;
    nextStatus: "SUBMITTED" | "APPROVED" | "RETURNED_FOR_CORRECTION" | "CANCELLED";
    reviewerOwnerId?: string;
    reason?: string | null;
  }
): Promise<boolean> {
  const res = await client.query(
    `UPDATE public.production_logs
     SET approval_status = $1::varchar(30),
         submitted_at = CASE WHEN $1::text = 'SUBMITTED' THEN COALESCE(submitted_at, NOW()) ELSE submitted_at END,
         reviewed_by_owner_id = CASE WHEN $1::text IN ('APPROVED', 'RETURNED_FOR_CORRECTION') THEN $2::uuid ELSE reviewed_by_owner_id END,
         reviewed_at = CASE WHEN $1::text IN ('APPROVED', 'RETURNED_FOR_CORRECTION') THEN NOW() ELSE reviewed_at END,
         review_reason = CASE WHEN $1::text IN ('APPROVED', 'RETURNED_FOR_CORRECTION') THEN $3::text ELSE review_reason END
     WHERE id = $4 AND version = $5`,
    [
      params.nextStatus,
      params.reviewerOwnerId ?? null,
      params.reason ?? null,
      params.id,
      params.expectedVersion,
    ]
  );
  return (res.rowCount ?? 0) === 1;
}
