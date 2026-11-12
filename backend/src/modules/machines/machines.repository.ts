import type { Pool, PoolClient } from "pg";
import type { OperationalApprovalStatus } from "../approvals/approvals.repository.js";
import type { MachineDto, MachineWorkLogDto } from "./machines.types.js";

export type DbClient = Pool | PoolClient;

interface MachineRow {
  id: number;
  machine_code: string;
  machine_name: string;
  machine_type: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
}

interface MachineLogRow {
  id: string | number;
  work_date: Date | string;
  machine_id: number;
  machine_code: string;
  machine_name: string;
  machine_type: string;
  operator_worker_id: string | number | null;
  operator_worker_name: string | null;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  downtime_minutes: number;
  downtime_reason: string | null;
  net_operating_hours: string;
  scheduled_hours: string | null;
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

function mapMachineRow(row: MachineRow): MachineDto {
  return {
    id: row.id,
    machineCode: row.machine_code,
    machineName: row.machine_name,
    machineType: row.machine_type,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  };
}

function computeUtilizationPercent(
  netHoursStr: string,
  scheduledHoursStr: string | null
): string | null {
  if (!scheduledHoursStr) return null;
  const net = Number(netHoursStr);
  const sched = Number(scheduledHoursStr);
  if (!Number.isFinite(net) || !Number.isFinite(sched) || sched <= 0) return null;
  return ((net / sched) * 100).toFixed(1);
}

function mapMachineLogRow(row: MachineLogRow): MachineWorkLogDto {
  return {
    id: Number(row.id),
    workDate: toDateOnly(row.work_date),
    machineId: row.machine_id,
    machineCode: row.machine_code,
    machineName: row.machine_name,
    machineType: row.machine_type,
    operatorWorkerId:
      row.operator_worker_id !== null ? Number(row.operator_worker_id) : null,
    operatorWorkerName: row.operator_worker_name,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    crossesMidnight: row.crosses_midnight,
    downtimeMinutes: row.downtime_minutes,
    downtimeReason: row.downtime_reason,
    netOperatingHours: row.net_operating_hours,
    scheduledHours: row.scheduled_hours,
    utilizationPercent: computeUtilizationPercent(
      row.net_operating_hours,
      row.scheduled_hours
    ),
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

export async function listMachines(
  client: DbClient,
  includeInactive = false
): Promise<MachineDto[]> {
  const whereSql = includeInactive ? "" : "WHERE is_active = true";
  const res = await client.query<MachineRow>(
    `SELECT id, machine_code, machine_name, machine_type, description, is_active, created_at
     FROM public.machines
     ${whereSql}
     ORDER BY LOWER(machine_name) ASC, id ASC`
  );
  return res.rows.map(mapMachineRow);
}

export async function findMachineById(
  client: DbClient,
  machineId: number
): Promise<MachineDto | null> {
  const res = await client.query<MachineRow>(
    `SELECT id, machine_code, machine_name, machine_type, description, is_active, created_at
     FROM public.machines WHERE id = $1 LIMIT 1`,
    [machineId]
  );
  return res.rows[0] ? mapMachineRow(res.rows[0]) : null;
}

export async function insertMachine(
  client: PoolClient,
  params: {
    machineCode: string;
    machineName: string;
    machineType: string;
    description: string | null;
    isActive: boolean;
    createdByUserId: string;
  }
): Promise<MachineDto> {
  const res = await client.query<MachineRow>(
    `INSERT INTO public.machines (
       machine_code, machine_name, machine_type, description, is_active, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, machine_code, machine_name, machine_type, description, is_active, created_at`,
    [
      params.machineCode,
      params.machineName,
      params.machineType,
      params.description,
      params.isActive,
      params.createdByUserId,
    ]
  );
  return mapMachineRow(res.rows[0]);
}

export async function updateMachineRow(
  client: PoolClient,
  machineId: number,
  params: {
    machineName: string;
    machineType: string;
    description: string | null;
    isActive: boolean;
  }
): Promise<MachineDto | null> {
  const res = await client.query<MachineRow>(
    `UPDATE public.machines
     SET machine_name = $1,
         machine_type = $2,
         description = $3,
         is_active = $4
     WHERE id = $5
     RETURNING id, machine_code, machine_name, machine_type, description, is_active, created_at`,
    [
      params.machineName,
      params.machineType,
      params.description,
      params.isActive,
      machineId,
    ]
  );
  return res.rows[0] ? mapMachineRow(res.rows[0]) : null;
}

export async function listMachineWorkLogs(
  client: DbClient,
  filters: {
    dateFrom?: string;
    dateTo?: string;
    machineId?: number;
    status?: OperationalApprovalStatus;
    limit?: number;
  }
): Promise<MachineWorkLogDto[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`ml.work_date >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`ml.work_date <= $${params.length}::date`);
  }
  if (filters.machineId !== undefined) {
    params.push(filters.machineId);
    conditions.push(`ml.machine_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`ml.approval_status = $${params.length}`);
  }

  params.push(Math.min(Math.max(filters.limit ?? 200, 1), 500));
  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const res = await client.query<MachineLogRow>(
    `SELECT
       ml.id, ml.work_date::text AS work_date, ml.machine_id,
       m.machine_code, m.machine_name, m.machine_type,
       ml.operator_worker_id, w.full_name AS operator_worker_name,
       ml.start_time::text AS start_time, ml.end_time::text AS end_time, ml.crosses_midnight,
       ml.downtime_minutes, ml.downtime_reason,
       ml.net_operating_hours::text AS net_operating_hours,
       ml.scheduled_hours::text AS scheduled_hours,
       ml.remarks, ml.entered_by_user_id, eu.full_name AS entered_by_name,
       ml.approval_status, ml.version, ml.submitted_at,
       ml.reviewed_by_owner_id, ru.full_name AS reviewed_by_name, ml.reviewed_at, ml.review_reason,
       ml.updated_at
     FROM public.machine_work_logs ml
     JOIN public.machines m ON m.id = ml.machine_id
     LEFT JOIN public.workers w ON w.id = ml.operator_worker_id
     JOIN public.users eu ON eu.id = ml.entered_by_user_id
     LEFT JOIN public.users ru ON ru.id = ml.reviewed_by_owner_id
     ${whereSql}
     ORDER BY ml.work_date DESC, ml.id DESC
     LIMIT $${params.length}`,
    params
  );

  return res.rows.map(mapMachineLogRow);
}

export async function findMachineWorkLogById(
  client: DbClient,
  id: number,
  forUpdate = false
): Promise<MachineWorkLogDto | null> {
  const lockClause = forUpdate ? "FOR UPDATE OF ml" : "";
  const res = await client.query<MachineLogRow>(
    `SELECT
       ml.id, ml.work_date::text AS work_date, ml.machine_id,
       m.machine_code, m.machine_name, m.machine_type,
       ml.operator_worker_id, w.full_name AS operator_worker_name,
       ml.start_time::text AS start_time, ml.end_time::text AS end_time, ml.crosses_midnight,
       ml.downtime_minutes, ml.downtime_reason,
       ml.net_operating_hours::text AS net_operating_hours,
       ml.scheduled_hours::text AS scheduled_hours,
       ml.remarks, ml.entered_by_user_id, eu.full_name AS entered_by_name,
       ml.approval_status, ml.version, ml.submitted_at,
       ml.reviewed_by_owner_id, ru.full_name AS reviewed_by_name, ml.reviewed_at, ml.review_reason,
       ml.updated_at
     FROM public.machine_work_logs ml
     JOIN public.machines m ON m.id = ml.machine_id
     LEFT JOIN public.workers w ON w.id = ml.operator_worker_id
     JOIN public.users eu ON eu.id = ml.entered_by_user_id
     LEFT JOIN public.users ru ON ru.id = ml.reviewed_by_owner_id
     WHERE ml.id = $1
     ${lockClause}`,
    [id]
  );
  return res.rows[0] ? mapMachineLogRow(res.rows[0]) : null;
}

export async function findAdjacentMachineIntervals(
  client: PoolClient,
  machineId: number,
  workDate: string,
  excludeId?: number
): Promise<
  Array<{
    id: number;
    workDate: string;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
  }>
> {
  const res = await client.query<{
    id: string | number;
    work_date: string;
    start_time: string;
    end_time: string;
    crosses_midnight: boolean;
  }>(
    `SELECT id, work_date::text AS work_date, start_time::text AS start_time,
            end_time::text AS end_time, crosses_midnight
     FROM public.machine_work_logs
     WHERE machine_id = $1
       AND approval_status <> 'CANCELLED'
       AND work_date BETWEEN ($2::date - INTERVAL '1 day')::date AND ($2::date + INTERVAL '1 day')::date
       AND ($3::bigint IS NULL OR id <> $3)`,
    [machineId, workDate, excludeId ?? null]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    workDate: r.work_date,
    startTime: r.start_time,
    endTime: r.end_time,
    crossesMidnight: r.crosses_midnight,
  }));
}

export async function insertMachineWorkLogDraft(
  client: PoolClient,
  params: {
    workDate: string;
    machineId: number;
    operatorWorkerId: number | null;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
    downtimeMinutes: number;
    downtimeReason: string | null;
    netOperatingHours: string;
    scheduledHours: string | null;
    remarks: string | null;
    enteredByUserId: string;
  }
): Promise<number> {
  const res = await client.query<{ id: string | number }>(
    `INSERT INTO public.machine_work_logs (
       work_date, machine_id, operator_worker_id, start_time, end_time, crosses_midnight,
       downtime_minutes, downtime_reason, net_operating_hours, scheduled_hours, remarks,
       entered_by_user_id, approval_status
     ) VALUES ($1::date, $2, $3, $4::time, $5::time, $6, $7, $8, $9, $10, $11, $12, 'DRAFT')
     RETURNING id`,
    [
      params.workDate,
      params.machineId,
      params.operatorWorkerId,
      params.startTime,
      params.endTime,
      params.crossesMidnight,
      params.downtimeMinutes,
      params.downtimeReason,
      params.netOperatingHours,
      params.scheduledHours,
      params.remarks,
      params.enteredByUserId,
    ]
  );
  return Number(res.rows[0].id);
}

export async function updateMachineWorkLogDraftRow(
  client: PoolClient,
  id: number,
  expectedVersion: number,
  params: {
    workDate: string;
    machineId: number;
    operatorWorkerId: number | null;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
    downtimeMinutes: number;
    downtimeReason: string | null;
    netOperatingHours: string;
    scheduledHours: string | null;
    remarks: string | null;
  }
): Promise<boolean> {
  const res = await client.query(
    `UPDATE public.machine_work_logs
     SET work_date = $1::date,
         machine_id = $2,
         operator_worker_id = $3,
         start_time = $4::time,
         end_time = $5::time,
         crosses_midnight = $6,
         downtime_minutes = $7,
         downtime_reason = $8,
         net_operating_hours = $9,
         scheduled_hours = $10,
         remarks = $11,
         approval_status = 'DRAFT',
         review_reason = NULL
     WHERE id = $12 AND version = $13 AND approval_status IN ('DRAFT', 'RETURNED_FOR_CORRECTION')`,
    [
      params.workDate,
      params.machineId,
      params.operatorWorkerId,
      params.startTime,
      params.endTime,
      params.crossesMidnight,
      params.downtimeMinutes,
      params.downtimeReason,
      params.netOperatingHours,
      params.scheduledHours,
      params.remarks,
      id,
      expectedVersion,
    ]
  );
  return (res.rowCount ?? 0) === 1;
}

export async function transitionMachineWorkLogStatus(
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
    `UPDATE public.machine_work_logs
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
