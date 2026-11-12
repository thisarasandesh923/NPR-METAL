import type { Pool, PoolClient } from "pg";
import type {
  MaterialPriceHistoryRow,
  MaterialRow,
} from "./materials.types.js";

export type DbClient = Pool | PoolClient;

export async function listActiveMaterials(
  client: DbClient
): Promise<MaterialRow[]> {
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
     WHERE is_active = true
     ORDER BY id ASC`
  );
  return result.rows;
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
  }
): Promise<MaterialRow | null> {
  const res = await client.query<MaterialRow>(
    `UPDATE public.materials
     SET current_unit_price = $1,
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
    [params.newPrice, params.materialId, params.expectedVersion]
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
  materialId?: number,
  limit = 100
): Promise<MaterialPriceHistoryRow[]> {
  const params: unknown[] = [];
  let whereSql = "";
  if (materialId !== undefined) {
    params.push(materialId);
    whereSql = "WHERE mph.material_id = $1";
  }
  params.push(limit);

  const res = await client.query<MaterialPriceHistoryRow>(
    `SELECT
       mph.id,
       mph.material_id,
       m.code AS material_code,
       m.name AS material_name,
       mph.old_price::text AS old_price,
       mph.new_price::text AS new_price,
       mph.changed_by_user_id,
       u.full_name AS changed_by_name,
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
