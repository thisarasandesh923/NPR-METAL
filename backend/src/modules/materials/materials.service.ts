import type { Pool } from "pg";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../errors/appError.js";
import { formatScaledDecimal, parseScaledDecimal } from "../../utils/money.js";
import { insertAuthAuditLog } from "../auth/auth.repository.js";
import {
  insertMaterialPriceHistory,
  listActiveMaterials,
  listMaterialPriceHistory,
  lockMaterialById,
  updateMaterialPriceRow,
} from "./materials.repository.js";
import type {
  MaterialCatalogItem,
  MaterialPriceHistoryDto,
  MaterialRow,
} from "./materials.types.js";

function mapMaterialRow(row: MaterialRow): MaterialCatalogItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unit: row.unit,
    currentUnitPrice: row.current_unit_price,
    isActive: row.is_active,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

export class MaterialsService {
  constructor(private readonly pool: Pool) {}

  async getActiveMaterials(): Promise<MaterialCatalogItem[]> {
    const rows = await listActiveMaterials(this.pool);
    return rows.map(mapMaterialRow);
  }

  async getPriceHistory(
    materialId?: number
  ): Promise<MaterialPriceHistoryDto[]> {
    const rows = await listMaterialPriceHistory(this.pool, materialId, 100);
    return rows.map((row) => ({
      id: Number(row.id),
      materialId: row.material_id,
      materialCode: row.material_code,
      materialName: row.material_name,
      oldPrice: row.old_price,
      newPrice: row.new_price,
      changedByUserId: row.changed_by_user_id,
      changedByName: row.changed_by_name,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async updatePrice(
    input: {
      materialId: number;
      newPrice: string | number;
      reason: string;
      expectedVersion: number;
    },
    actor: { ownerUserId: string; ipAddress: string }
  ): Promise<MaterialCatalogItem> {
    let newPriceCents: bigint;
    try {
      newPriceCents = parseScaledDecimal(input.newPrice, 2, "Selling price");
    } catch (err) {
      throw new ValidationError(
        err instanceof Error ? err.message : "Invalid selling price."
      );
    }

    if (newPriceCents < 0n || newPriceCents > 9_999_999_999_99n) {
      throw new ValidationError("Selling price is out of valid bounds.");
    }

    const newPriceStr = formatScaledDecimal(newPriceCents, 2);

    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const current = await lockMaterialById(client, input.materialId);
      if (!current) {
        throw new NotFoundError("Material not found.");
      }

      if (current.version !== input.expectedVersion) {
        throw new ConflictError(
          "This material price was modified by another session. Reload the latest prices before updating.",
          "VERSION_CONFLICT"
        );
      }

      const oldPriceCents = parseScaledDecimal(
        current.current_unit_price,
        2,
        "Current price"
      );
      if (oldPriceCents === newPriceCents) {
        throw new ValidationError(
          "New price must differ from the current selling price."
        );
      }

      const updated = await updateMaterialPriceRow(client, {
        materialId: current.id,
        newPrice: newPriceStr,
        expectedVersion: input.expectedVersion,
      });

      if (!updated) {
        throw new ConflictError(
          "Concurrent price update detected. Please retry.",
          "VERSION_CONFLICT"
        );
      }

      await insertMaterialPriceHistory(client, {
        materialId: current.id,
        oldPrice: current.current_unit_price,
        newPrice: newPriceStr,
        changedByUserId: actor.ownerUserId,
        reason: input.reason.trim(),
      });

      await insertAuthAuditLog(client, {
        userId: actor.ownerUserId,
        action: "UPDATE_MATERIAL_PRICE",
        entityType: "MATERIAL",
        entityId: String(current.id),
        details: {
          code: current.code,
          name: current.name,
          oldPrice: current.current_unit_price,
          newPrice: newPriceStr,
          reason: input.reason.trim(),
        },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      return mapMaterialRow(updated);
    } catch (err) {
      if (inTx) {
        await client.query("ROLLBACK").catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
