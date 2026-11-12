import type { Pool } from "pg";
import { listActiveMaterials } from "./materials.repository.js";
import type { MaterialCatalogItem } from "./materials.types.js";

export class MaterialsService {
  constructor(private readonly pool: Pool) {}

  async getActiveMaterials(): Promise<MaterialCatalogItem[]> {
    const rows = await listActiveMaterials(this.pool);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      unit: row.unit,
      currentUnitPrice: row.current_unit_price,
      isActive: row.is_active,
    }));
  }
}
