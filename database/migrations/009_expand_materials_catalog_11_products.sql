-- Up Migration
-- =============================================================================
-- Migration 009: Expand Materials Catalogue to 11 Products
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • Forward-only transactional catalog expansion.
--   • Preserves existing 4 product IDs, codes, prices, and price change histories.
--   • Updates display names of the 4 foundational materials:
--       - '3/4'   -> '3/4 Metal'
--       - 'DUST'  -> 'Dust'
--       - '6X9'   -> '6×9 (Aggregate)'
--       - 'ABC'   -> 'ABC'
--   • Adds the 7 approved new materials in INACTIVE state (is_active = false)
--     with default price 0.00 and standard unit 'm³':
--       - 'CHIP'        ('Chip')
--       - '2X2'         ('2×2')
--       - '1_INCH'      ('1" (Inch)')
--       - '1_1/2'       ('1 1/2')
--       - 'SUBBASE'     ('SubBase')
--       - 'MIX'         ('Mix (Dust & Chip)')
--       - 'QUARRY_MUCK' ('Quarry Muck')
--   • Inactive materials cannot be billed by cashiers until an authorized Owner
--     configures a valid selling price and activates them.
--   • Preserves historical invoices, snapshot lines, and payments permanently.
-- =============================================================================

-- 1. Ensure the 4 foundational materials exist and update their display names
INSERT INTO public.materials (code, name, unit, current_unit_price, is_active, version)
VALUES
    ('3/4', '3/4 Metal', 'm³', 12000.00, true, 1),
    ('DUST', 'Dust', 'm³', 8500.00, true, 1),
    ('6X9', '6×9 (Aggregate)', 'm³', 10250.00, true, 1),
    ('ABC', 'ABC', 'm³', 11000.00, true, 1)
ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        unit = 'm³',
        updated_at = NOW();

-- 2. Insert the 7 new materials in INACTIVE state with 0.00 price and unit 'm³'
-- Never invent product prices: new products remain inactive until Owner configures selling price.
INSERT INTO public.materials (code, name, unit, current_unit_price, is_active, version)
VALUES
    ('CHIP', 'Chip', 'm³', 0.00, false, 1),
    ('2X2', '2×2', 'm³', 0.00, false, 1),
    ('1_INCH', '1" (Inch)', 'm³', 0.00, false, 1),
    ('1_1/2', '1 1/2', 'm³', 0.00, false, 1),
    ('SUBBASE', 'SubBase', 'm³', 0.00, false, 1),
    ('MIX', 'Mix (Dust & Chip)', 'm³', 0.00, false, 1),
    ('QUARRY_MUCK', 'Quarry Muck', 'm³', 0.00, false, 1)
ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        unit = 'm³',
        updated_at = NOW();
