export interface MaterialCatalogItem {
  id: number;
  code: string;
  name: string;
  unit: string;
  currentUnitPrice: string;
  isActive: boolean;
}

export interface MaterialRow {
  id: number;
  code: string;
  name: string;
  unit: string;
  current_unit_price: string;
  is_active: boolean;
}
