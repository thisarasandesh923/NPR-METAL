import type { Pool, PoolClient } from "pg";

export type DbClient = Pool | PoolClient;

export type OperationalRecordType =
  | "ATTENDANCE"
  | "MACHINE_LOG"
  | "PRODUCTION_LOG";

export type OperationalApprovalStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "RETURNED_FOR_CORRECTION"
  | "CANCELLED";

export interface OperationalHistoryDto {
  id: number;
  recordType: OperationalRecordType;
  recordId: number;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: string;
  actorName: string;
  reason: string | null;
  snapshot: unknown;
  createdAt: string;
}

interface OperationalHistoryRow {
  id: string | number;
  record_type: OperationalRecordType;
  record_id: string | number;
  action: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string;
  actor_name: string;
  reason: string | null;
  snapshot: unknown;
  created_at: Date;
}

export async function insertOperationalHistory(
  client: PoolClient,
  params: {
    recordType: OperationalRecordType;
    recordId: number;
    action:
      | "CREATED"
      | "UPDATED_DRAFT"
      | "SUBMITTED"
      | "APPROVED"
      | "RETURNED_FOR_CORRECTION"
      | "CANCELLED";
    fromStatus: string | null;
    toStatus: string;
    actorUserId: string;
    reason?: string | null;
    snapshot: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO public.operational_approval_history (
       record_type,
       record_id,
       action,
       from_status,
       to_status,
       actor_user_id,
       reason,
       snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      params.recordType,
      params.recordId,
      params.action,
      params.fromStatus,
      params.toStatus,
      params.actorUserId,
      params.reason ?? null,
      JSON.stringify(params.snapshot),
    ]
  );
}

export async function listOperationalHistory(
  client: DbClient,
  params: {
    recordType?: OperationalRecordType;
    recordId?: number;
    limit?: number;
  }
): Promise<OperationalHistoryDto[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.recordType) {
    values.push(params.recordType);
    conditions.push(`h.record_type = $${values.length}`);
  }
  if (params.recordId !== undefined) {
    values.push(params.recordId);
    conditions.push(`h.record_id = $${values.length}`);
  }

  values.push(Math.min(Math.max(params.limit ?? 100, 1), 200));
  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const res = await client.query<OperationalHistoryRow>(
    `SELECT
       h.id,
       h.record_type,
       h.record_id,
       h.action,
       h.from_status,
       h.to_status,
       h.actor_user_id,
       u.full_name AS actor_name,
       h.reason,
       h.snapshot,
       h.created_at
     FROM public.operational_approval_history h
     JOIN public.users u ON u.id = h.actor_user_id
     ${whereSql}
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT $${values.length}`,
    values
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    recordType: r.record_type,
    recordId: Number(r.record_id),
    action: r.action,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actorUserId: r.actor_user_id,
    actorName: r.actor_name,
    reason: r.reason,
    snapshot: r.snapshot,
    createdAt: r.created_at.toISOString(),
  }));
}

