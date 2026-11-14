import type { MaterialName, MaterialRow } from "../../types/invoice";

/**
 * Demo material prices in Sri Lankan Rupees (LKR).
 * NOTE: These are client-side demo prices for UI prototyping.
 * In production, authoritative prices are managed by the Owner in PostgreSQL.
 */
export const DEMO_CONFIGURED_PRICES: Record<MaterialName, number> = {
  '3/4"': 12000,
  Dust: 8000,
  "6×9": 10500,
  ABC: 11500,

};

export const DEMO_MATERIAL_OPTIONS = Object.keys(DEMO_CONFIGURED_PRICES) as MaterialName[];

export const INITIAL_DEMO_INVOICE_ITEMS: MaterialRow[] = [
  { id: 1, material: '3/4"', quantity: 5.5, price: DEMO_CONFIGURED_PRICES['3/4"'] },
  { id: 2, material: "Dust", quantity: 2, price: DEMO_CONFIGURED_PRICES.Dust },
];
