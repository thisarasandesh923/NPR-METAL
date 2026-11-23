import type { Pool, PoolClient } from "pg";
import type {
  MaterialPriceHistoryFilters,
  MaterialPriceHistoryRow,
  MaterialRow,
  MaterialVehiclePriceHistoryRow,
  MaterialVehiclePriceRow,
  VehicleCategory,
} from "./materials.types.js";

export type DbClient = Pool | PoolClient;

export interface MaterialWithVehiclePriceRow extends MaterialRow {
  vehicle_category?: VehicleCategory;
  price_per_ft3?: string | null;
  vehicle_price_version?: number;
}

export async function listMaterials(
  client: DbClient,
  includeInactive = false
): Promise<MaterialRow[]> {
  const whereSql = includeInactive ? "" : "WHERE m.is_active = true";
  const result = await client.query<MaterialRow>(
    `SELECT
       m.id,
       m.code,
       m.name,
       m.unit,
       m.current_unit_price::text AS current_unit_price,
       m.is_active,
       m.version,
       m.updated_at,
       COALESCE(
         json_agg(
           json_build_object(
             'vehicleCategory', mvp.vehicle_category,
             'pricePerFt3', mvp.price_per_ft3::text,
             'version', mvp.version,
             'updatedAt', mvp.updated_at
           )
         ) FILTER (WHERE mvp.id IS NOT NULL),
         '[]'::json
       ) AS vehicle_prices
     FROM public.materials m
     LEFT JOIN public.material_vehicle_prices mvp ON mvp.material_id = m.id
     ${whereSql}
     GROUP BY m.id, m.code, m.name, m.unit, m.current_unit_price, m.is_active, m.version, m.updated_at
     ORDER BY m.id ASC`
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

export async function findActiveMaterialsWithVehiclePrices(
  client: DbClient,
  materialIds: number[],
  vehicleCategory: VehicleCategory
): Promise<MaterialWithVehiclePriceRow[]> {
  if (materialIds.length === 0) {
    return [];
  }
  const result = await client.query<MaterialWithVehiclePriceRow>(
    `SELECT
       m.id,
       m.code,
       m.name,
       m.unit,
       m.current_unit_price::text AS current_unit_price,
       m.is_active,
       m.version,
       m.updated_at,
       mvp.vehicle_category,
       mvp.price_per_ft3::text AS price_per_ft3,
       mvp.version AS vehicle_price_version
     FROM public.materials m
     LEFT JOIN public.material_vehicle_prices mvp
       ON mvp.material_id = m.id AND mvp.vehicle_category = $2
     WHERE m.id = ANY($1::int[]) AND m.is_active = true`,
    [materialIds, vehicleCategory]
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

export async function lockMaterialVehiclePrice(
  client: PoolClient,
  materialId: number,
  vehicleCategory: VehicleCategory
): Promise<MaterialVehiclePriceRow | null> {
  const res = await client.query<MaterialVehiclePriceRow>(
    `SELECT
       mvp.id,
       mvp.material_id,
       mvp.vehicle_category,
       mvp.price_per_ft3::text AS price_per_ft3,
       mvp.version,
       mvp.updated_at,
       m.name AS material_name,
       m.code AS material_code,
       m.is_active AS material_is_active
     FROM public.material_vehicle_prices mvp
     JOIN public.materials m ON m.id = mvp.material_id
     WHERE mvp.material_id = $1 AND mvp.vehicle_category = $2
     FOR UPDATE`,
    [materialId, vehicleCategory]
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

export async function updateMaterialVehiclePriceRow(
  client: PoolClient,
  params: {
    materialId: number;
    vehicleCategory: VehicleCategory;
    newPrice: string;
    expectedVersion: number;
  }
): Promise<MaterialVehiclePriceRow | null> {
  const res = await client.query<MaterialVehiclePriceRow>(
    `UPDATE public.material_vehicle_prices
     SET price_per_ft3 = $1,
         version = version + 1
     WHERE material_id = $2 AND vehicle_category = $3 AND version = $4
     RETURNING
       id,
       material_id,
       vehicle_category,
       price_per_ft3::text AS price_per_ft3,
       version,
       updated_at`,
    [
      params.newPrice,
      params.materialId,
      params.vehicleCategory,
      params.expectedVersion,
    ]
  );
  return res.rows[0] ?? null;
}

export async function setMaterialActiveStatus(
  client: PoolClient,
  materialId: number,
  isActive: boolean
): Promise<MaterialRow | null> {
  const res = await client.query<MaterialRow>(
    `UPDATE public.materials
     SET is_active = $1,
         version = version + 1
     WHERE id = $2
     RETURNING
       id,
       code,
       name,
       unit,
       current_unit_price::text AS current_unit_price,
       is_active,
       version,
       updated_at`,
    [isActive, materialId]
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

export async function insertMaterialVehiclePriceHistory(
  client: PoolClient,
  params: {
    materialId: number;
    vehicleCategory: VehicleCategory;
    oldPrice: string | null;
    newPrice: string;
    oldVersion: number | null;
    newVersion: number;
    changedByUserId: string;
    reason: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO public.material_vehicle_price_history (
       material_id,
       vehicle_category,
       old_price_per_ft3,
       new_price_per_ft3,
       old_version,
       new_version,
       changed_by_user_id,
       reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.materialId,
      params.vehicleCategory,
      params.oldPrice,
      params.newPrice,
      params.oldVersion,
      params.newVersion,
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

export async function listMaterialVehiclePriceHistory(
  client: DbClient,
  filters?: MaterialPriceHistoryFilters | number,
  limit = 100
): Promise<MaterialVehiclePriceHistoryRow[]> {
  const normFilters: MaterialPriceHistoryFilters =
    typeof filters === "number" ? { materialId: filters, limit } : (filters ?? {});

  const params: unknown[] = [];
  const whereClauses: string[] = [];

  if (normFilters.materialId !== undefined) {
    params.push(normFilters.materialId);
    whereClauses.push(`mvph.material_id = $${params.length}`);
  }

  if (normFilters.vehicleCategory !== undefined && normFilters.vehicleCategory !== "ALL") {
    params.push(normFilters.vehicleCategory);
    whereClauses.push(`mvph.vehicle_category = $${params.length}`);
  }

  if (normFilters.userId !== undefined && normFilters.userId.trim() !== "") {
    const searchVal = normFilters.userId.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        searchVal
      );
    if (isUuid) {
      params.push(searchVal);
      whereClauses.push(`mvph.changed_by_user_id = $${params.length}`);
    } else {
      params.push(`%${searchVal}%`);
      whereClauses.push(
        `(u.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`
      );
    }
  }

  if (normFilters.dateFrom !== undefined && normFilters.dateFrom.trim() !== "") {
    params.push(normFilters.dateFrom.trim());
    whereClauses.push(`mvph.created_at >= ($${params.length}::date AT TIME ZONE 'Asia/Colombo')`);
  }

  if (normFilters.dateTo !== undefined && normFilters.dateTo.trim() !== "") {
    params.push(normFilters.dateTo.trim());
    whereClauses.push(`mvph.created_at < (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Colombo')`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const maxLimit = Math.min(Math.max(normFilters.limit ?? limit ?? 100, 1), 200);
  params.push(maxLimit);

  const res = await client.query<MaterialVehiclePriceHistoryRow>(
    `SELECT
       mvph.id,
       mvph.material_id,
       m.code AS material_code,
       m.name AS material_name,
       mvph.vehicle_category,
       mvph.old_price_per_ft3::text AS old_price_per_ft3,
       mvph.new_price_per_ft3::text AS new_price_per_ft3,
       mvph.old_version,
       mvph.new_version,
       mvph.changed_by_user_id,
       u.username AS changed_by_username,
       u.full_name AS changed_by_name,
       u.role AS changed_by_role,
       mvph.reason,
       mvph.created_at
     FROM public.material_vehicle_price_history mvph
     JOIN public.materials m ON m.id = mvph.material_id
     JOIN public.users u ON u.id = mvph.changed_by_user_id
     ${whereSql}
     ORDER BY mvph.created_at DESC, mvph.id DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows;
}
