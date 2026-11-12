import type { Pool, PoolClient } from "pg";
import type { OperationalApprovalStatus } from "../approvals/approvals.repository.js";
import type {
  EmploymentStatus,
  WorkerAttendanceDto,
  WorkerDto,
} from "./workers.types.js";

export type DbClient = Pool | PoolClient;

interface WorkerRow {
  id: string | number;
  worker_code: string;
  full_name: string;
  phone: string | null;
  designation: string;
  joined_date: Date | string | null;
  employment_status: EmploymentStatus;
  notes: string | null;
  created_at: Date;
}

interface AttendanceRow {
  id: string | number;
  work_date: Date | string;
  worker_id: string | number;
  worker_code: string;
  worker_name: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  break_minutes: number;
  hours_worked: string;
  overtime_hours: string;
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

function toDateOnly(v: Date | string | null): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}

function mapWorkerRow(row: WorkerRow): WorkerDto {
  return {
    id: Number(row.id),
    workerCode: row.worker_code,
    fullName: row.full_name,
    phone: row.phone,
    designation: row.designation,
    joinedDate: toDateOnly(row.joined_date),
    employmentStatus: row.employment_status,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

function mapAttendanceRow(row: AttendanceRow): WorkerAttendanceDto {
  return {
    id: Number(row.id),
    workDate: toDateOnly(row.work_date)!,
    workerId: Number(row.worker_id),
    workerCode: row.worker_code,
    workerName: row.worker_name,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    crossesMidnight: row.crosses_midnight,
    breakMinutes: row.break_minutes,
    hoursWorked: row.hours_worked,
    overtimeHours: row.overtime_hours,
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

export async function listWorkers(
  client: DbClient,
  includeInactive = false
): Promise<WorkerDto[]> {
  const whereSql = includeInactive
    ? ""
    : "WHERE employment_status = 'ACTIVE'";
  const res = await client.query<WorkerRow>(
    `SELECT
       id, worker_code, full_name, phone, designation,
       joined_date::text AS joined_date, employment_status, notes, created_at
     FROM public.workers
     ${whereSql}
     ORDER BY LOWER(full_name) ASC, id ASC`
  );
  return res.rows.map(mapWorkerRow);
}

export async function findWorkerById(
  client: DbClient,
  workerId: number
): Promise<WorkerDto | null> {
  const res = await client.query<WorkerRow>(
    `SELECT
       id, worker_code, full_name, phone, designation,
       joined_date::text AS joined_date, employment_status, notes, created_at
     FROM public.workers WHERE id = $1 LIMIT 1`,
    [workerId]
  );
  return res.rows[0] ? mapWorkerRow(res.rows[0]) : null;
}

export async function insertWorker(
  client: PoolClient,
  params: {
    workerCode: string;
    fullName: string;
    phone: string | null;
    designation: string;
    joinedDate: string | null;
    employmentStatus: EmploymentStatus;
    notes: string | null;
    createdByUserId: string;
  }
): Promise<WorkerDto> {
  const res = await client.query<WorkerRow>(
    `INSERT INTO public.workers (
       worker_code, full_name, phone, designation, joined_date,
       employment_status, notes, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, worker_code, full_name, phone, designation,
       joined_date::text AS joined_date, employment_status, notes, created_at`,
    [
      params.workerCode,
      params.fullName,
      params.phone,
      params.designation,
      params.joinedDate,
      params.employmentStatus,
      params.notes,
      params.createdByUserId,
    ]
  );
  return mapWorkerRow(res.rows[0]);
}

export async function updateWorkerRow(
  client: PoolClient,
  workerId: number,
  params: {
    fullName: string;
    phone: string | null;
    designation: string;
    joinedDate: string | null;
    employmentStatus: EmploymentStatus;
    notes: string | null;
  }
): Promise<WorkerDto | null> {
  const res = await client.query<WorkerRow>(
    `UPDATE public.workers
     SET full_name = $1,
         phone = $2,
         designation = $3,
         joined_date = $4,
         employment_status = $5,
         notes = $6
     WHERE id = $7
     RETURNING id, worker_code, full_name, phone, designation,
       joined_date::text AS joined_date, employment_status, notes, created_at`,
    [
      params.fullName,
      params.phone,
      params.designation,
      params.joinedDate,
      params.employmentStatus,
      params.notes,
      workerId,
    ]
  );
  return res.rows[0] ? mapWorkerRow(res.rows[0]) : null;
}

export async function listAttendanceRecords(
  client: DbClient,
  filters: {
    dateFrom?: string;
    dateTo?: string;
    workerId?: number;
    status?: OperationalApprovalStatus;
    limit?: number;
  }
): Promise<WorkerAttendanceDto[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`a.work_date >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`a.work_date <= $${params.length}::date`);
  }
  if (filters.workerId !== undefined) {
    params.push(filters.workerId);
    conditions.push(`a.worker_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`a.approval_status = $${params.length}`);
  }

  params.push(Math.min(Math.max(filters.limit ?? 200, 1), 500));
  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const res = await client.query<AttendanceRow>(
    `SELECT
       a.id, a.work_date::text AS work_date, a.worker_id, w.worker_code, w.full_name AS worker_name,
       a.start_time::text AS start_time, a.end_time::text AS end_time, a.crosses_midnight,
       a.break_minutes, a.hours_worked::text AS hours_worked, a.overtime_hours::text AS overtime_hours,
       a.remarks, a.entered_by_user_id, eu.full_name AS entered_by_name,
       a.approval_status, a.version, a.submitted_at,
       a.reviewed_by_owner_id, ru.full_name AS reviewed_by_name, a.reviewed_at, a.review_reason,
       a.updated_at
     FROM public.worker_attendance a
     JOIN public.workers w ON w.id = a.worker_id
     JOIN public.users eu ON eu.id = a.entered_by_user_id
     LEFT JOIN public.users ru ON ru.id = a.reviewed_by_owner_id
     ${whereSql}
     ORDER BY a.work_date DESC, a.id DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map(mapAttendanceRow);
}

export async function findAttendanceById(
  client: DbClient,
  id: number,
  forUpdate = false
): Promise<WorkerAttendanceDto | null> {
  const lockClause = forUpdate ? "FOR UPDATE OF a" : "";
  const res = await client.query<AttendanceRow>(
    `SELECT
       a.id, a.work_date::text AS work_date, a.worker_id, w.worker_code, w.full_name AS worker_name,
       a.start_time::text AS start_time, a.end_time::text AS end_time, a.crosses_midnight,
       a.break_minutes, a.hours_worked::text AS hours_worked, a.overtime_hours::text AS overtime_hours,
       a.remarks, a.entered_by_user_id, eu.full_name AS entered_by_name,
       a.approval_status, a.version, a.submitted_at,
       a.reviewed_by_owner_id, ru.full_name AS reviewed_by_name, a.reviewed_at, a.review_reason,
       a.updated_at
     FROM public.worker_attendance a
     JOIN public.workers w ON w.id = a.worker_id
     JOIN public.users eu ON eu.id = a.entered_by_user_id
     LEFT JOIN public.users ru ON ru.id = a.reviewed_by_owner_id
     WHERE a.id = $1
     ${lockClause}`,
    [id]
  );
  return res.rows[0] ? mapAttendanceRow(res.rows[0]) : null;
}

export async function findAdjacentWorkerAttendanceIntervals(
  client: PoolClient,
  workerId: number,
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
     FROM public.worker_attendance
     WHERE worker_id = $1
       AND approval_status <> 'CANCELLED'
       AND work_date BETWEEN ($2::date - INTERVAL '1 day')::date AND ($2::date + INTERVAL '1 day')::date
       AND ($3::bigint IS NULL OR id <> $3)`,
    [workerId, workDate, excludeId ?? null]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    workDate: r.work_date,
    startTime: r.start_time,
    endTime: r.end_time,
    crossesMidnight: r.crosses_midnight,
  }));
}

export async function insertAttendanceDraft(
  client: PoolClient,
  params: {
    workDate: string;
    workerId: number;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
    breakMinutes: number;
    hoursWorked: string;
    overtimeHours: string;
    remarks: string | null;
    enteredByUserId: string;
  }
): Promise<number> {
  const res = await client.query<{ id: string | number }>(
    `INSERT INTO public.worker_attendance (
       work_date, worker_id, start_time, end_time, crosses_midnight,
       break_minutes, hours_worked, overtime_hours, remarks,
       entered_by_user_id, approval_status
     ) VALUES ($1::date, $2, $3::time, $4::time, $5, $6, $7, $8, $9, $10, 'DRAFT')
     RETURNING id`,
    [
      params.workDate,
      params.workerId,
      params.startTime,
      params.endTime,
      params.crossesMidnight,
      params.breakMinutes,
      params.hoursWorked,
      params.overtimeHours,
      params.remarks,
      params.enteredByUserId,
    ]
  );
  return Number(res.rows[0].id);
}

export async function updateAttendanceDraftRow(
  client: PoolClient,
  id: number,
  expectedVersion: number,
  params: {
    workDate: string;
    workerId: number;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
    breakMinutes: number;
    hoursWorked: string;
    overtimeHours: string;
    remarks: string | null;
  }
): Promise<boolean> {
  const res = await client.query(
    `UPDATE public.worker_attendance
     SET work_date = $1::date,
         worker_id = $2,
         start_time = $3::time,
         end_time = $4::time,
         crosses_midnight = $5,
         break_minutes = $6,
         hours_worked = $7,
         overtime_hours = $8,
         remarks = $9,
         approval_status = 'DRAFT',
         review_reason = NULL
     WHERE id = $10 AND version = $11 AND approval_status IN ('DRAFT', 'RETURNED_FOR_CORRECTION')`,
    [
      params.workDate,
      params.workerId,
      params.startTime,
      params.endTime,
      params.crossesMidnight,
      params.breakMinutes,
      params.hoursWorked,
      params.overtimeHours,
      params.remarks,
      id,
      expectedVersion,
    ]
  );
  return (res.rowCount ?? 0) === 1;
}

export async function transitionAttendanceStatus(
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
    `UPDATE public.worker_attendance
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
