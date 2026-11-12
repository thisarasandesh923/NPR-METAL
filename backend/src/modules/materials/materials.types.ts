export interface MaterialCatalogItem {
  id: number;
  code: string;
  name: string;
  unit: string;
  currentUnitPrice: string;
  isActive: boolean;
  version: number;
  updatedAt: string;
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
}

export interface MaterialPriceHistoryDto {
  id: number;
  materialId: number;
  materialCode: string;
  materialName: string;
  oldPrice: string;
  newPrice: string;
  changedByUserId: string;
  changedByName: string;
  reason: string;
  createdAt: string;
}

export interface MaterialPriceHistoryRow {
  id: string | number;
  material_id: number;
  material_code: string;
  material_name: string;
  old_price: string;
  new_price: string;
  changed_by_user_id: string;
  changed_by_name: string;
  reason: string;
  created_at: Date;
}
