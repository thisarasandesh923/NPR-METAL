-- Up Migration
-- =============================================================================
-- Migration 002: Invoices & Frozen Line Items
-- Project: NPR Metal Crusher — Billing & Management System
-- Provisional Decisions:
--   • Continuous server-generated invoice numbering without annual resets.
--   • PostgreSQL sequences are NOT gapless (rolled-back TXs consume numbers).
--   • Material quantity precision is NUMERIC(10, 3) for cubic meters (m³).
--   • LKR monetary amounts use exact NUMERIC(12, 2).
-- =============================================================================

CREATE SEQUENCE invoice_number_seq START WITH 1 INCREMENT BY 1;

-- 1. Invoices (Commercial Contract Core)
-- Note: New invoices enter as 'DRAFT' strictly inside an atomic issuance TX and
-- must transition to 'ISSUED' prior to commit (enforced by deferred trigger in 005).
CREATE TABLE invoices (
    id BIGSERIAL PRIMARY KEY,
    invoice_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('NPR-INV-' || LPAD(nextval('invoice_number_seq')::text, 6, '0')),
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    customer_name_snapshot VARCHAR(150) NOT NULL,
    customer_phone_snapshot VARCHAR(20) NOT NULL,
    customer_location_snapshot VARCHAR(255) NOT NULL,
    has_transport BOOLEAN NOT NULL DEFAULT false,
    transport_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (transport_fee >= 0.00),
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0.00),
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (grand_total >= 0.00),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'CANCELLED')),
    issued_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    issued_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_invoices_customer_name_len CHECK (length(trim(customer_name_snapshot)) >= 2),
    CONSTRAINT chk_invoices_customer_phone_len CHECK (length(trim(customer_phone_snapshot)) >= 7),
    CONSTRAINT chk_invoices_customer_loc_len CHECK (length(trim(customer_location_snapshot)) >= 2),
    CONSTRAINT chk_invoices_grand_total CHECK (grand_total = ROUND(subtotal + transport_fee, 2)),
    CONSTRAINT chk_invoices_transport_consistency CHECK (has_transport = true OR transport_fee = 0.00),
    CONSTRAINT chk_invoices_issued_timestamp CHECK (
        (status = 'DRAFT' AND issued_at IS NULL) OR
        (status IN ('ISSUED', 'CANCELLED') AND issued_at IS NOT NULL)
    )
);

CREATE INDEX idx_invoices_customer_issued ON invoices(customer_id, issued_at DESC);
CREATE INDEX idx_invoices_issued_at ON invoices(issued_at DESC);
CREATE INDEX idx_invoices_status_issued ON invoices(status, issued_at DESC);
CREATE INDEX idx_invoices_issued_by_user ON invoices(issued_by_user_id, issued_at DESC);

-- 2. Invoice Items (Frozen Line Itemization)
CREATE TABLE invoice_items (
    id BIGSERIAL PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    material_id INT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    material_name_snapshot VARCHAR(100) NOT NULL CHECK (length(trim(material_name_snapshot)) >= 1),
    quantity NUMERIC(10, 3) NOT NULL CHECK (quantity > 0.000),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0.00),
    line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0.00),
    CONSTRAINT chk_invoice_items_line_total CHECK (line_total = ROUND(quantity * unit_price, 2))
);

CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_material_id ON invoice_items(material_id);
