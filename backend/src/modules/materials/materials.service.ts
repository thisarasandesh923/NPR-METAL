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
  listMaterials,
  listMaterialPriceHistory,
  lockMaterialById,
  updateMaterialPriceRow,
} from "./materials.repository.js";
import type {
  MaterialCatalogItem,
  MaterialPriceHistoryDto,
  MaterialPriceHistoryFilters,
  MaterialRow,
  UpdateMaterialPriceInput,
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

  async getMaterials(includeInactive = false): Promise<MaterialCatalogItem[]> {
    const rows = await listMaterials(this.pool, includeInactive);
    return rows.map(mapMaterialRow);
  }

  async getActiveMaterials(): Promise<MaterialCatalogItem[]> {
    return this.getMaterials(false);
  }

  async getPriceHistory(
    filters?: MaterialPriceHistoryFilters | number
  ): Promise<MaterialPriceHistoryDto[]> {
    const rows = await listMaterialPriceHistory(this.pool, filters, 100);
    return rows.map((row) => ({
      id: Number(row.id),
      materialId: row.material_id,
      materialCode: row.material_code,
      materialName: row.material_name,
      oldPrice: row.old_price,
      newPrice: row.new_price,
      changedByUserId: row.changed_by_user_id,
      changedByUsername: row.changed_by_username,
      changedByName: row.changed_by_name,
      changedByRole: row.changed_by_role,
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
      isActive?: boolean;
    },
    actor: {
      userId?: string;
      ownerUserId?: string;
      username?: string;
      role?: string;
      ipAddress: string;
    }
  ): Promise<MaterialCatalogItem> {
    let newPriceCents: bigint;
    try {
      newPriceCents = parseScaledDecimal(input.newPrice, 2, "Selling price");
    } catch (err) {
      throw new ValidationError(
        err instanceof Error ? err.message : "Invalid selling price."
      );
    }

    if (newPriceCents <= 0n || newPriceCents > 9_999_999_999_99n) {
      throw new ValidationError("Selling price must be greater than Rs. 0.00.");
    }

    const newPriceStr = formatScaledDecimal(newPriceCents, 2);
    const actorUserId = actor.userId ?? actor.ownerUserId;
    if (!actorUserId) {
      throw new ValidationError("User identifier is required.");
    }

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

      // Cashiers can only update prices for active materials
      if (!current.is_active && actor.role !== "OWNER") {
        throw new ValidationError(
          "Cashiers can only update prices for active materials. Inactive materials must be configured and activated by the Owner."
        );
      }

      // Cashiers are strictly forbidden from modifying active/inactive status
      if (input.isActive !== undefined && actor.role !== "OWNER") {
        throw new ValidationError(
          "Only Owner accounts are permitted to activate or deactivate materials."
        );
      }

      const targetIsActive =
        input.isActive !== undefined ? input.isActive : current.is_active;

      if (targetIsActive && newPriceCents <= 0n) {
        throw new ValidationError(
          "Cannot activate a material without a valid positive selling price."
        );
      }

      const oldPriceCents = parseScaledDecimal(
        current.current_unit_price,
        2,
        "Current price"
      );
      if (
        oldPriceCents === newPriceCents &&
        current.is_active === targetIsActive
      ) {
        throw new ValidationError(
          "New price or activation status must differ from current state."
        );
      }

      const updated = await updateMaterialPriceRow(client, {
        materialId: current.id,
        newPrice: newPriceStr,
        expectedVersion: input.expectedVersion,
        isActive: targetIsActive,
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
        changedByUserId: actorUserId,
        reason: input.reason.trim(),
      });

      await insertAuthAuditLog(client, {
        userId: actorUserId,
        action: "UPDATE_MATERIAL_PRICE",
        entityType: "MATERIAL",
        entityId: String(current.id),
        details: {
          code: current.code,
          name: current.name,
          oldPrice: current.current_unit_price,
          newPrice: newPriceStr,
          oldIsActive: current.is_active,
          newIsActive: targetIsActive,
          reason: input.reason.trim(),
          actorUsername: actor.username ?? null,
          actorRole: actor.role ?? null,
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
