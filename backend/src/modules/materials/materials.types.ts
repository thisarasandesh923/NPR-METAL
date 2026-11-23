export type VehicleCategory = "TRACTOR" | "TIPPER";

export interface MaterialVehiclePriceDto {
  vehicleCategory: VehicleCategory;
  pricePerFt3: string | null;
  version: number;
  updatedAt: string;
}

export interface MaterialCatalogItem {
  id: number;
  code: string;
  name: string;
  unit: string;
  currentUnitPrice: string;
  isActive: boolean;
  version: number;
  updatedAt: string;
  vehiclePrices?: Record<VehicleCategory, MaterialVehiclePriceDto | null>;
  tractorPricePerFt3?: string | null;
  tipperPricePerFt3?: string | null;
}

export interface MaterialRow {
  id: number;
  code: string;
  name: string;
  unit: string;
  current_unit_price: string;
  is_active: boolean;
  version: number;
  updated_at: Date;
  vehicle_prices?:
    | Array<{
        vehicleCategory: VehicleCategory;
        pricePerFt3: string | null;
        version: number;
        updatedAt: string;
      }>
    | string;
}

export interface MaterialVehiclePriceRow {
  id: number;
  material_id: number;
  vehicle_category: VehicleCategory;
  price_per_ft3: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  material_name?: string;
  material_code?: string;
  material_is_active?: boolean;
}

export interface MaterialVehiclePriceHistoryDto {
  id: number;
  materialId: number;
  materialCode: string;
  materialName: string;
  vehicleCategory: VehicleCategory;
  oldPrice: string | null;
  newPrice: string;
  oldVersion: number | null;
  newVersion: number;
  changedByUserId: string;
  changedByUsername: string;
  changedByName: string;
  changedByRole: string;
  reason: string;
  createdAt: string;
}

export interface MaterialVehiclePriceHistoryRow {
  id: string | number;
  material_id: number;
  material_code: string;
  material_name: string;
  vehicle_category: VehicleCategory;
  old_price_per_ft3: string | null;
  new_price_per_ft3: string;
  old_version: number | null;
  new_version: number;
  changed_by_user_id: string;
  changed_by_username: string;
  changed_by_name: string;
  changed_by_role: string;
  reason: string;
  created_at: Date;
}

export interface MaterialPriceHistoryDto {
  id: number;
  materialId: number;
  materialCode: string;
  materialName: string;
  oldPrice: string | null;
  newPrice: string;
  changedByUserId: string;
  changedByUsername: string;
  changedByName: string;
  changedByRole: string;
  reason: string;
  createdAt: string;
  vehicleCategory?: VehicleCategory | null;
  oldVersion?: number | null;
  newVersion?: number | null;
}

export interface MaterialPriceHistoryRow {
  id: string | number;
  material_id: number;
  material_code: string;
  material_name: string;
  old_price: string;
  new_price: string;
  changed_by_user_id: string;
  changed_by_username: string;
  changed_by_name: string;
  changed_by_role: string;
  reason: string;
  created_at: Date;
  vehicle_category?: VehicleCategory | null;
  old_version?: number | null;
  new_version?: number | null;
}

export interface MaterialPriceHistoryFilters {
  materialId?: number;
  vehicleCategory?: VehicleCategory | "ALL";
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface UpdateMaterialPriceInput {
  materialId: number;
  vehicleCategory?: VehicleCategory;
  newPrice: string | number;
  reason: string;
  expectedVersion: number;
  isActive?: boolean;
}
