import type { MaterialName, MaterialRow } from "../../types/invoice";

/**
 * Demo material prices in Sri Lankan Rupees (LKR).
 * NOTE: These are client-side demo prices for UI prototyping.
 * In production, authoritative prices are managed by the Owner in PostgreSQL.
 */
export const DEMO_CONFIGURED_PRICES: Record<MaterialName, number> = {
  "3/4 Metal": 12000,
  Dust: 8000,
  Chip: 9500,
  "6×9 (Aggregate)": 10500,
  "2×2": 11000,
  '1" (Inch)': 11500,
  "1 1/2": 11200,
  ABC: 11500,
  SubBase: 9000,
  "Mix (Dust & Chip)": 8800,
  "Quarry Muck": 6500,
  // Legacy aliases
  '3/4"': 12000,
  "6×9": 10500,
};

export const DEMO_MATERIAL_OPTIONS = Object.keys(DEMO_CONFIGURED_PRICES) as MaterialName[];

export const INITIAL_DEMO_INVOICE_ITEMS: MaterialRow[] = [
  { id: 1, material: "3/4 Metal", quantity: 5.5, price: DEMO_CONFIGURED_PRICES["3/4 Metal"] },
  { id: 2, material: "Dust", quantity: 2, price: DEMO_CONFIGURED_PRICES.Dust },
];
