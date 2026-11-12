import type { Pool, PoolClient } from "pg";
import type { SessionAuthRow, UserAuthRow } from "./auth.types.js";

export type DbClient = Pool | PoolClient;

export interface ThrottleSnapshot {
  userFailureCount: number;
  userOldestFailureAt: Date | null;
  ipFailureCount: number;
  ipOldestFailureAt: Date | null;
}

export async function findUserForLogin(
  client: DbClient,
  normalizedUsername: string
): Promise<UserAuthRow | null> {
  const result = await client.query<UserAuthRow>(
    `SELECT id, username, password_hash, full_name, role, is_active
     FROM public.users
     WHERE LOWER(username) = $1
     LIMIT 1`,
    [normalizedUsername]
  );
  return result.rows[0] ?? null;
}

export async function acquireLoginThrottleLocks(
  client: PoolClient,
  userEntityId: string,
  ipAddress: string
): Promise<void> {
  const keys = [`u:${userEntityId}`, `i:${ipAddress}`].sort();
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    keys[0],
  ]);
  if (keys[1] !== keys[0]) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      keys[1],
    ]);
  }
}

export async function getLoginThrottleState(
  client: DbClient,
  params: {
    userEntityId: string;
    ipAddress: string;
    windowMs: number;
  }
): Promise<ThrottleSnapshot> {
  const successRes = await client.query<{ last_success_at: Date | null }>(
    `SELECT MAX(created_at) AS last_success_at
     FROM public.audit_logs
     WHERE entity_type = 'AUTH_LOGIN'
       AND entity_id = $1
       AND action = 'LOGIN_SUCCEEDED'
       AND created_at >= NOW() - ($2::bigint * INTERVAL '1 millisecond')`,
    [params.userEntityId, params.windowMs]
  );

  const lastSuccessAt = successRes.rows[0]?.last_success_at ?? null;

  const userFailRes = await client.query<{
    cnt: number;
    oldest_at: Date | null;
  }>(
    `SELECT COUNT(*)::int AS cnt, MIN(created_at) AS oldest_at
     FROM public.audit_logs
     WHERE entity_type = 'AUTH_LOGIN'
       AND entity_id = $1
       AND action = 'LOGIN_FAILED'
       AND created_at >= GREATEST(
         NOW() - ($2::bigint * INTERVAL '1 millisecond'),
         COALESCE($3::timestamptz, '-infinity'::timestamptz)
       )`,
    [params.userEntityId, params.windowMs, lastSuccessAt]
  );

  const ipFailRes = await client.query<{
    cnt: number;
    oldest_at: Date | null;
  }>(
    `SELECT COUNT(*)::int AS cnt, MIN(created_at) AS oldest_at
     FROM public.audit_logs
     WHERE entity_type = 'AUTH_LOGIN'
       AND action = 'LOGIN_FAILED'
       AND ip_address = $1
       AND created_at >= NOW() - ($2::bigint * INTERVAL '1 millisecond')`,
    [params.ipAddress, params.windowMs]
  );

  return {
    userFailureCount: userFailRes.rows[0]?.cnt ?? 0,
    userOldestFailureAt: userFailRes.rows[0]?.oldest_at ?? null,
    ipFailureCount: ipFailRes.rows[0]?.cnt ?? 0,
    ipOldestFailureAt: ipFailRes.rows[0]?.oldest_at ?? null,
  };
}

export async function insertAuthAuditLog(
  client: DbClient,
  params: {
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    details: Record<string, unknown>;
    ipAddress: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO public.audit_logs
       (user_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      params.userId,
      params.action,
      params.entityType,
      params.entityId,
      JSON.stringify(params.details),
      params.ipAddress,
    ]
  );
}

export async function createSession(
  client: DbClient,
  params: {
    tokenHash: string;
    userId: string;
    ipAddress: string | null;
    userAgent: string | null;
    expiresAt: Date;
  }
): Promise<{ id: string; expiresAt: Date }> {
  const result = await client.query<{ id: string; expires_at: Date }>(
    `INSERT INTO public.user_sessions
       (token_hash, user_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, expires_at`,
    [
      params.tokenHash,
      params.userId,
      params.ipAddress,
      params.userAgent,
      params.expiresAt,
    ]
  );
  return {
    id: result.rows[0].id,
    expiresAt: result.rows[0].expires_at,
  };
}

export async function deleteSessionByTokenHash(
  client: DbClient,
  tokenHash: string
): Promise<{ id: string; userId: string } | null> {
  const result = await client.query<{ id: string; user_id: string }>(
    `DELETE FROM public.user_sessions
     WHERE token_hash = $1
     RETURNING id, user_id`,
    [tokenHash]
  );
  if (!result.rows[0]) {
    return null;
  }
  return {
    id: result.rows[0].id,
    userId: result.rows[0].user_id,
  };
}

export async function purgeExpiredUserSessions(
  client: DbClient,
  userId: string
): Promise<void> {
  await client.query(
    `DELETE FROM public.user_sessions
     WHERE user_id = $1 AND expires_at <= NOW()`,
    [userId]
  );
}

export async function findSessionWithUserByTokenHash(
  client: DbClient,
  tokenHash: string
): Promise<SessionAuthRow | null> {
  const result = await client.query<SessionAuthRow>(
    `SELECT
       s.id AS session_id,
       s.expires_at,
       s.created_at,
       u.id,
       u.username,
       u.full_name,
       u.role,
       u.is_active
     FROM public.user_sessions s
     JOIN public.users u ON u.id = s.user_id
     WHERE s.token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] ?? null;
}

export async function renewSessionExpiry(
  client: DbClient,
  params: {
    sessionId: string;
    newExpiresAt: Date;
  }
): Promise<Date | null> {
  const result = await client.query<{ expires_at: Date }>(
    `UPDATE public.user_sessions
     SET expires_at = $1
     WHERE id = $2 AND expires_at > NOW()
     RETURNING expires_at`,
    [params.newExpiresAt, params.sessionId]
  );
  return result.rows[0]?.expires_at ?? null;
}
