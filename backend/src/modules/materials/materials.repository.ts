import type { Pool, PoolClient } from "pg";
import type {
  MaterialPriceHistoryFilters,
  MaterialPriceHistoryRow,
  MaterialRow,
} from "./materials.types.js";

export type DbClient = Pool | PoolClient;

export async function listMaterials(
  client: DbClient,
  includeInactive = false
): Promise<MaterialRow[]> {
  const whereSql = includeInactive ? "" : "WHERE is_active = true";
  const result = await client.query<MaterialRow>(
    `SELECT
       id,
       code,
       name,
       unit,
       current_unit_price::text AS current_unit_price,
       is_active,
       version,
       updated_at
     FROM public.materials
     ${whereSql}
     ORDER BY id ASC`
  );
  return result.rows;
}

export async function listActiveMaterials(
  client: DbClient
): Promise<MaterialRow[]> {
  return listMaterials(client, false);
}

export async function findActiveMaterialsByIds(
  client: DbClient,
  materialIds: number[]
): Promise<MaterialRow[]> {
  if (materialIds.length === 0) {
    return [];
  }
  const result = await client.query<MaterialRow>(
    `SELECT
       id,
       code,
       name,
       unit,
       current_unit_price::text AS current_unit_price,
       is_active,
       version,
       updated_at
     FROM public.materials
     WHERE id = ANY($1::int[]) AND is_active = true`,
    [materialIds]
  );
  return result.rows;
}

export async function lockMaterialById(
  client: PoolClient,
  materialId: number
): Promise<MaterialRow | null> {
  const res = await client.query<MaterialRow>(
    `SELECT
       id,
       code,
       name,
       unit,
       current_unit_price::text AS current_unit_price,
       is_active,
       version,
       updated_at
     FROM public.materials
     WHERE id = $1
     FOR UPDATE`,
    [materialId]
  );
  return res.rows[0] ?? null;
}

export async function updateMaterialPriceRow(
  client: PoolClient,
  params: {
    materialId: number;
    newPrice: string;
    expectedVersion: number;
    isActive?: boolean;
  }
): Promise<MaterialRow | null> {
  const res = await client.query<MaterialRow>(
    `UPDATE public.materials
     SET current_unit_price = $1,
         is_active = COALESCE($4, is_active),
         version = version + 1
     WHERE id = $2 AND version = $3
     RETURNING
       id,
       code,
       name,
       unit,
       current_unit_price::text AS current_unit_price,
       is_active,
       version,
       updated_at`,
    [
      params.newPrice,
      params.materialId,
      params.expectedVersion,
      params.isActive ?? null,
    ]
  );
  return res.rows[0] ?? null;
}

export async function insertMaterialPriceHistory(
  client: PoolClient,
  params: {
    materialId: number;
    oldPrice: string;
    newPrice: string;
    changedByUserId: string;
    reason: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO public.material_price_history (
       material_id,
       old_price,
       new_price,
       changed_by_user_id,
       reason
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      params.materialId,
      params.oldPrice,
      params.newPrice,
      params.changedByUserId,
      params.reason,
    ]
  );
}

export async function listMaterialPriceHistory(
  client: DbClient,
  filters?: MaterialPriceHistoryFilters | number,
  limit = 100
): Promise<MaterialPriceHistoryRow[]> {
  const normFilters: MaterialPriceHistoryFilters =
    typeof filters === "number" ? { materialId: filters, limit } : (filters ?? {});

  const params: unknown[] = [];
  const whereClauses: string[] = [];

  if (normFilters.materialId !== undefined) {
    params.push(normFilters.materialId);
    whereClauses.push(`mph.material_id = $${params.length}`);
  }

  if (normFilters.userId !== undefined && normFilters.userId.trim() !== "") {
    const searchVal = normFilters.userId.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        searchVal
      );
    if (isUuid) {
      params.push(searchVal);
      whereClauses.push(`mph.changed_by_user_id = $${params.length}`);
    } else {
      params.push(`%${searchVal}%`);
      whereClauses.push(
        `(u.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`
      );
    }
  }

  if (normFilters.dateFrom !== undefined && normFilters.dateFrom.trim() !== "") {
    params.push(normFilters.dateFrom.trim());
    whereClauses.push(`mph.created_at >= ($${params.length}::date AT TIME ZONE 'Asia/Colombo')`);
  }

  if (normFilters.dateTo !== undefined && normFilters.dateTo.trim() !== "") {
    params.push(normFilters.dateTo.trim());
    whereClauses.push(`mph.created_at < (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Colombo')`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const maxLimit = Math.min(Math.max(normFilters.limit ?? limit ?? 100, 1), 200);
  params.push(maxLimit);

  const res = await client.query<MaterialPriceHistoryRow>(
    `SELECT
       mph.id,
       mph.material_id,
       m.code AS material_code,
       m.name AS material_name,
       mph.old_price::text AS old_price,
       mph.new_price::text AS new_price,
       mph.changed_by_user_id,
       u.username AS changed_by_username,
       u.full_name AS changed_by_name,
       u.role AS changed_by_role,
       mph.reason,
       mph.created_at
     FROM public.material_price_history mph
     JOIN public.materials m ON m.id = mph.material_id
     JOIN public.users u ON u.id = mph.changed_by_user_id
     ${whereSql}
     ORDER BY mph.created_at DESC, mph.id DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows;
}
