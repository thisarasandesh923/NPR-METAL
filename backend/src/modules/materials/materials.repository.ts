import type { Pool, PoolClient } from "pg";
import type { MaterialRow } from "./materials.types.js";

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
       is_active
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
       is_active
     FROM public.materials
     WHERE id = ANY($1::int[]) AND is_active = true`,
    [materialIds]
  );
  return result.rows;
}
