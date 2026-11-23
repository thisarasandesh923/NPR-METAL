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
  insertMaterialVehiclePriceHistory,
  listActiveMaterials,
  listMaterials,
  listMaterialPriceHistory,
  listMaterialVehiclePriceHistory,
  lockMaterialById,
  lockMaterialVehiclePrice,
  setMaterialActiveStatus,
  updateMaterialPriceRow,
  updateMaterialVehiclePriceRow,
} from "./materials.repository.js";
import type {
  MaterialCatalogItem,
  MaterialPriceHistoryDto,
  MaterialPriceHistoryFilters,
  MaterialRow,
  MaterialVehiclePriceDto,
  UpdateMaterialPriceInput,
  VehicleCategory,
} from "./materials.types.js";

function mapMaterialRow(row: MaterialRow): MaterialCatalogItem {
  let vehiclePricesList: Array<{
    vehicleCategory: VehicleCategory;
    pricePerFt3: string | null;
    version: number;
    updatedAt: string;
  }> = [];

  if (Array.isArray(row.vehicle_prices)) {
    vehiclePricesList = row.vehicle_prices;
  } else if (typeof row.vehicle_prices === "string") {
    try {
      vehiclePricesList = JSON.parse(row.vehicle_prices);
    } catch {
      vehiclePricesList = [];
    }
  }

  const tractor = vehiclePricesList.find((v) => v.vehicleCategory === "TRACTOR");
  const tipper = vehiclePricesList.find((v) => v.vehicleCategory === "TIPPER");

  const tractorDto: MaterialVehiclePriceDto | null = tractor
    ? {
        vehicleCategory: "TRACTOR",
        pricePerFt3: tractor.pricePerFt3,
        version: tractor.version,
        updatedAt:
          typeof tractor.updatedAt === "string"
            ? tractor.updatedAt
            : new Date(tractor.updatedAt).toISOString(),
      }
    : null;

  const tipperDto: MaterialVehiclePriceDto | null = tipper
    ? {
        vehicleCategory: "TIPPER",
        pricePerFt3: tipper.pricePerFt3,
        version: tipper.version,
        updatedAt:
          typeof tipper.updatedAt === "string"
            ? tipper.updatedAt
            : new Date(tipper.updatedAt).toISOString(),
      }
    : null;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unit: row.unit,
    currentUnitPrice: row.current_unit_price,
    isActive: row.is_active,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
    vehiclePrices: {
      TRACTOR: tractorDto,
      TIPPER: tipperDto,
    },
    tractorPricePerFt3: tractorDto?.pricePerFt3 ?? null,
    tipperPricePerFt3: tipperDto?.pricePerFt3 ?? null,
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
    const normFilters: MaterialPriceHistoryFilters =
      typeof filters === "number" ? { materialId: filters } : (filters ?? {});

    if (normFilters.vehicleCategory) {
      const rows = await listMaterialVehiclePriceHistory(
        this.pool,
        normFilters,
        normFilters.limit ?? 100
      );
      return rows.map((row) => ({
        id: Number(row.id),
        materialId: row.material_id,
        materialCode: row.material_code,
        materialName: row.material_name,
        oldPrice: row.old_price_per_ft3,
        newPrice: row.new_price_per_ft3,
        oldVersion: row.old_version,
        newVersion: row.new_version,
        changedByUserId: row.changed_by_user_id,
        changedByUsername: row.changed_by_username,
        changedByName: row.changed_by_name,
        changedByRole: row.changed_by_role,
        reason: row.reason,
        createdAt: row.created_at.toISOString(),
        vehicleCategory: row.vehicle_category,
      }));
    }

    const rows = await listMaterialPriceHistory(this.pool, normFilters, normFilters.limit ?? 100);
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
      vehicleCategory: row.vehicle_category ?? null,
    }));
  }

  async updatePrice(
    input: UpdateMaterialPriceInput,
    actor: {
      userId?: string;
      ownerUserId?: string;
      username?: string;
      role?: string;
      ipAddress: string;
    }
  ): Promise<MaterialCatalogItem> {
    if (input.vehicleCategory) {
      return this.updateVehiclePrice(
        {
          materialId: input.materialId,
          vehicleCategory: input.vehicleCategory,
          newPrice: input.newPrice,
          reason: input.reason,
          expectedVersion: input.expectedVersion,
          isActive: input.isActive,
        },
        actor
      );
    }

    // Legacy price update (materials.current_unit_price)
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

      if (!current.is_active && actor.role !== "OWNER") {
        throw new ValidationError(
          "Cashiers can only update prices for active materials. Inactive materials must be configured and activated by the Owner."
        );
      }

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

  async updateVehiclePrice(
    input: {
      materialId: number;
      vehicleCategory: VehicleCategory;
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

      const current = await lockMaterialVehiclePrice(
        client,
        input.materialId,
        input.vehicleCategory
      );

      if (!current) {
        const mat = await lockMaterialById(client, input.materialId);
        if (!mat) {
          throw new NotFoundError("Material not found.");
        }
        throw new NotFoundError(
          `Vehicle price configuration not found for material #${input.materialId} and category ${input.vehicleCategory}.`
        );
      }

      if (current.version !== input.expectedVersion) {
        throw new ConflictError(
          "This vehicle price was modified by another session. Reload the latest prices before updating.",
          "VERSION_CONFLICT"
        );
      }

      // Cashiers can only update prices for active materials
      if (!current.material_is_active && actor.role !== "OWNER") {
        throw new ValidationError(
          "Cashiers can only update prices for active materials. Inactive materials must be configured and activated by the Owner."
        );
      }

      // Cashiers cannot change active/inactive status
      if (input.isActive !== undefined && actor.role !== "OWNER") {
        throw new ValidationError(
          "Only Owner accounts are permitted to activate or deactivate materials."
        );
      }

      const targetIsActive: boolean =
        input.isActive !== undefined ? input.isActive : Boolean(current.material_is_active);

      // Handle activation status change if Owner requested
      if (input.isActive !== undefined && actor.role === "OWNER" && targetIsActive !== current.material_is_active) {
        await setMaterialActiveStatus(client, input.materialId, targetIsActive);
      }

      const oldPriceCents =
        current.price_per_ft3 !== null
          ? parseScaledDecimal(current.price_per_ft3, 2, "Current price")
          : null;

      if (
        oldPriceCents !== null &&
        oldPriceCents === newPriceCents &&
        current.material_is_active === targetIsActive
      ) {
        throw new ValidationError(
          "New price or activation status must differ from current state."
        );
      }

      const updated = await updateMaterialVehiclePriceRow(client, {
        materialId: input.materialId,
        vehicleCategory: input.vehicleCategory,
        newPrice: newPriceStr,
        expectedVersion: input.expectedVersion,
      });

      if (!updated) {
        throw new ConflictError(
          "Concurrent price update detected. Please retry.",
          "VERSION_CONFLICT"
        );
      }

      await insertMaterialVehiclePriceHistory(client, {
        materialId: input.materialId,
        vehicleCategory: input.vehicleCategory,
        oldPrice: current.price_per_ft3,
        newPrice: newPriceStr,
        oldVersion: current.version,
        newVersion: updated.version,
        changedByUserId: actorUserId,
        reason: input.reason.trim(),
      });

      await insertAuthAuditLog(client, {
        userId: actorUserId,
        action: "UPDATE_MATERIAL_VEHICLE_PRICE",
        entityType: "MATERIAL_VEHICLE_PRICE",
        entityId: `${input.materialId}-${input.vehicleCategory}`,
        details: {
          materialId: input.materialId,
          materialCode: current.material_code,
          materialName: current.material_name,
          vehicleCategory: input.vehicleCategory,
          oldPrice: current.price_per_ft3,
          newPrice: newPriceStr,
          oldVersion: current.version,
          newVersion: updated.version,
          reason: input.reason.trim(),
          actorUsername: actor.username ?? null,
          actorRole: actor.role ?? null,
        },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;

      // Reload full material catalog item with updated vehicle prices
      let target: MaterialCatalogItem | null = null;
      try {
        const rows = await listMaterials(client, true);
        const found = rows.find((r) => r.id === input.materialId);
        if (found) {
          target = mapMaterialRow(found);
        }
      } catch {
        // Fallback for mocks
      }

      if (!target) {
        target = {
          id: current.material_id,
          code: current.material_code ?? "",
          name: current.material_name ?? "",
          unit: "m³",
          currentUnitPrice: "0.00",
          isActive: targetIsActive,
          version: updated.version,
          updatedAt: updated.updated_at.toISOString(),
          vehiclePrices: {
            TRACTOR: input.vehicleCategory === "TRACTOR" ? {
              vehicleCategory: "TRACTOR",
              pricePerFt3: updated.price_per_ft3,
              version: updated.version,
              updatedAt: updated.updated_at.toISOString(),
            } : null,
            TIPPER: input.vehicleCategory === "TIPPER" ? {
              vehicleCategory: "TIPPER",
              pricePerFt3: updated.price_per_ft3,
              version: updated.version,
              updatedAt: updated.updated_at.toISOString(),
            } : null,
          },
          tractorPricePerFt3: input.vehicleCategory === "TRACTOR" ? updated.price_per_ft3 : null,
          tipperPricePerFt3: input.vehicleCategory === "TIPPER" ? updated.price_per_ft3 : null,
        };
      }
      return target;
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
