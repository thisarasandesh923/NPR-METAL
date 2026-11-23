-- Up Migration
-- =============================================================================
-- Migration 015: Vehicle-Category ft³ Pricing & Commercial Invoice Snapshots
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • All new material sales transition to cubic feet (ft³).
--   • Materials have independent selling prices per ft³ for TRACTOR and TIPPER.
--   • Server determines the correct unit price using the selected vehicle category.
--   • Material Price Management supports separate price updates per vehicle
--     category, optimistic version concurrency, and permanent audit history.
--   • Unconfigured vehicle-category prices block invoice issuance.
--   • Historical invoices and line items preserve historical quantities, m³ labels,
--     prices, and totals (NULL vehicle_category and unit_snapshot).
--   • Invoices commercial terms (vehicle_category, unit_snapshot) remain immutable.
--   • Transport fee logic and calculations remain completely unchanged.
-- =============================================================================

-- 1. Vehicle-Specific Material Selling Prices Table
CREATE TABLE material_vehicle_prices (
    id SERIAL PRIMARY KEY,
    material_id INT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    vehicle_category VARCHAR(20) NOT NULL CHECK (vehicle_category IN ('TRACTOR', 'TIPPER')),
    price_per_ft3 NUMERIC(12, 2) CHECK (price_per_ft3 IS NULL OR price_per_ft3 >= 0.00),
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_material_vehicle_prices UNIQUE (material_id, vehicle_category)
);

CREATE INDEX idx_material_vehicle_prices_material
    ON material_vehicle_prices(material_id);

CREATE INDEX idx_material_vehicle_prices_category
    ON material_vehicle_prices(vehicle_category);

CREATE TRIGGER trg_material_vehicle_prices_set_updated_at
    BEFORE UPDATE ON material_vehicle_prices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Auditable Material Vehicle Price Change History (Append-Only)
CREATE TABLE material_vehicle_price_history (
    id BIGSERIAL PRIMARY KEY,
    material_id INT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    vehicle_category VARCHAR(20) NOT NULL CHECK (vehicle_category IN ('TRACTOR', 'TIPPER')),
    old_price_per_ft3 NUMERIC(12, 2) CHECK (old_price_per_ft3 IS NULL OR old_price_per_ft3 >= 0.00),
    new_price_per_ft3 NUMERIC(12, 2) NOT NULL CHECK (new_price_per_ft3 >= 0.00),
    old_version INT CHECK (old_version IS NULL OR old_version >= 1),
    new_version INT NOT NULL CHECK (new_version >= 1),
    changed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_material_vehicle_price_history_material_created
    ON material_vehicle_price_history(material_id, vehicle_category, created_at DESC);

CREATE TRIGGER trg_mat_veh_price_history_append_only
    BEFORE UPDATE OR DELETE ON material_vehicle_price_history
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER trg_mat_veh_price_history_actor
    BEFORE INSERT ON material_vehicle_price_history
    FOR EACH ROW EXECUTE FUNCTION enforce_price_history_owner();

-- 3. Initial Population: Seed TRACTOR and TIPPER rows for all existing materials
-- Note: price_per_ft3 is initialized to NULL so no artificial or converted prices
-- are invented. Unconfigured prices will explicitly block invoice issuance until
-- an authorized Owner or Cashier configures the real price.
INSERT INTO material_vehicle_prices (material_id, vehicle_category, price_per_ft3, version)
SELECT m.id, v.category, NULL, 1
FROM materials m
CROSS JOIN (VALUES ('TRACTOR'::varchar(20)), ('TIPPER'::varchar(20))) AS v(category)
ON CONFLICT (material_id, vehicle_category) DO NOTHING;

-- 4. Invoices & Line Items Snapshot Columns for Vehicle Category & Unit
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS vehicle_category VARCHAR(20) NULL,
    ADD COLUMN IF NOT EXISTS unit_snapshot VARCHAR(10) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoices_vehicle_category'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT chk_invoices_vehicle_category
            CHECK (vehicle_category IS NULL OR vehicle_category IN ('TRACTOR', 'TIPPER'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoices_unit_snapshot'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT chk_invoices_unit_snapshot
            CHECK (unit_snapshot IS NULL OR unit_snapshot IN ('m³', 'ft³'));
    END IF;
END
$$;

ALTER TABLE invoice_items
    ADD COLUMN IF NOT EXISTS unit_snapshot VARCHAR(10) NULL,
    ADD COLUMN IF NOT EXISTS vehicle_category_snapshot VARCHAR(20) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_items_unit_snapshot'
    ) THEN
        ALTER TABLE invoice_items
            ADD CONSTRAINT chk_invoice_items_unit_snapshot
            CHECK (unit_snapshot IS NULL OR unit_snapshot IN ('m³', 'ft³'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_items_vehicle_category'
    ) THEN
        ALTER TABLE invoice_items
            ADD CONSTRAINT chk_invoice_items_vehicle_category
            CHECK (vehicle_category_snapshot IS NULL OR vehicle_category_snapshot IN ('TRACTOR', 'TIPPER'));
    END IF;
END
$$;

-- 5. Extend Invoice Immutability to Protect Vehicle Category & Unit Snapshots
CREATE OR REPLACE FUNCTION enforce_invoice_before_update()
RETURNS TRIGGER AS $$
DECLARE
    v_item_count BIGINT;
    v_items_subtotal NUMERIC(12, 2);
    v_total_credited NUMERIC(12, 2);
BEGIN
    -- Transition 1: Finalizing DRAFT -> ISSUED inside original issuance transaction
    IF OLD.status = 'DRAFT' AND NEW.status = 'ISSUED' THEN
        IF (NEW.id IS DISTINCT FROM OLD.id OR
            NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR
            NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
            NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot OR
            NEW.customer_phone_snapshot IS DISTINCT FROM OLD.customer_phone_snapshot OR
            NEW.customer_location_snapshot IS DISTINCT FROM OLD.customer_location_snapshot OR
            NEW.has_transport IS DISTINCT FROM OLD.has_transport OR
            NEW.transport_fee IS DISTINCT FROM OLD.transport_fee OR
            NEW.issued_by_user_id IS DISTINCT FROM OLD.issued_by_user_id OR
            NEW.created_at IS DISTINCT FROM OLD.created_at OR
            NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category OR
            NEW.unit_snapshot IS DISTINCT FROM OLD.unit_snapshot) THEN
            RAISE EXCEPTION 'Invoice customer, number, vehicle, unit, and transport attributes cannot be altered during finalization';
        END IF;

        SELECT COUNT(*), COALESCE(SUM(line_total), 0.00)::NUMERIC(12, 2)
        INTO v_item_count, v_items_subtotal
        FROM invoice_items
        WHERE invoice_id = NEW.id;

        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'Cannot finalize invoice % with zero line items', OLD.invoice_number;
        END IF;

        IF NEW.subtotal <> v_items_subtotal THEN
            RAISE EXCEPTION 'Invoice subtotal (%) does not match sum of line items (%)',
                NEW.subtotal, v_items_subtotal;
        END IF;

        NEW.issued_at := COALESCE(NEW.issued_at, NOW());
        RETURN NEW;
    END IF;

    IF OLD.status = 'DRAFT' THEN
        RAISE EXCEPTION 'DRAFT invoice % can only transition directly to ISSUED', OLD.invoice_number;
    END IF;

    -- Transition 2: Authorized Cancellation (ISSUED -> CANCELLED) backed by full credit note
    IF OLD.status = 'ISSUED' AND NEW.status = 'CANCELLED' THEN
        IF (NEW.id IS DISTINCT FROM OLD.id OR
            NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR
            NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
            NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot OR
            NEW.customer_phone_snapshot IS DISTINCT FROM OLD.customer_phone_snapshot OR
            NEW.customer_location_snapshot IS DISTINCT FROM OLD.customer_location_snapshot OR
            NEW.has_transport IS DISTINCT FROM OLD.has_transport OR
            NEW.transport_fee IS DISTINCT FROM OLD.transport_fee OR
            NEW.subtotal IS DISTINCT FROM OLD.subtotal OR
            NEW.grand_total IS DISTINCT FROM OLD.grand_total OR
            NEW.issued_by_user_id IS DISTINCT FROM OLD.issued_by_user_id OR
            NEW.issued_at IS DISTINCT FROM OLD.issued_at OR
            NEW.created_at IS DISTINCT FROM OLD.created_at OR
            NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category OR
            NEW.unit_snapshot IS DISTINCT FROM OLD.unit_snapshot) THEN
            RAISE EXCEPTION 'Issued invoice commercial details are permanently immutable';
        END IF;

        SELECT COALESCE(SUM(credit_amount), 0.00)::NUMERIC(12, 2)
        INTO v_total_credited
        FROM credit_notes
        WHERE invoice_id = NEW.id;

        IF v_total_credited <> OLD.grand_total THEN
            RAISE EXCEPTION 'Cannot cancel invoice % without full credit note coverage (credited: %, grand_total: %)',
                OLD.invoice_number, v_total_credited, OLD.grand_total;
        END IF;

        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Issued or cancelled invoice commercial terms are permanently immutable';
END;
$$ LANGUAGE plpgsql;

-- 6. Update Invoice Ledger View to Expose vehicle_category and unit_snapshot
CREATE OR REPLACE VIEW invoice_ledger_view AS
WITH payment_totals AS (
    SELECT
        invoice_id,
        COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2) AS gross_paid
    FROM payments
    GROUP BY invoice_id
),
adjustment_totals AS (
    SELECT
        py.invoice_id,
        COALESCE(SUM(pa.adjustment_amount) FILTER (WHERE pa.adjustment_type = 'ENTRY_REVERSAL'), 0.00)::NUMERIC(12, 2) AS total_entry_reversals,
        COALESCE(SUM(pa.adjustment_amount) FILTER (WHERE pa.adjustment_type = 'CASH_REFUND'), 0.00)::NUMERIC(12, 2) AS total_cash_refunded,
        COALESCE(SUM(pa.adjustment_amount), 0.00)::NUMERIC(12, 2) AS total_adjustments
    FROM payment_adjustments pa
    JOIN payments py ON py.id = pa.payment_id
    GROUP BY py.invoice_id
),
credit_totals AS (
    SELECT
        invoice_id,
        COALESCE(SUM(credit_amount), 0.00)::NUMERIC(12, 2) AS total_credited
    FROM credit_notes
    GROUP BY invoice_id
)
SELECT
    i.id AS invoice_id,
    i.invoice_number,
    i.customer_id,
    i.customer_name_snapshot,
    i.customer_phone_snapshot,
    i.customer_location_snapshot,
    i.has_transport,
    i.transport_fee,
    i.subtotal,
    i.grand_total AS original_grand_total,
    COALESCE(ct.total_credited, 0.00)::NUMERIC(12, 2) AS total_credited,
    (i.grand_total - COALESCE(ct.total_credited, 0.00))::NUMERIC(12, 2) AS effective_grand_total,
    COALESCE(pt.gross_paid, 0.00)::NUMERIC(12, 2) AS gross_recorded_receipts,
    COALESCE(at.total_entry_reversals, 0.00)::NUMERIC(12, 2) AS total_entry_reversals,
    (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_entry_reversals, 0.00))::NUMERIC(12, 2) AS corrected_net_receipts,
    COALESCE(at.total_cash_refunded, 0.00)::NUMERIC(12, 2) AS total_cash_refunded,
    (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))::NUMERIC(12, 2) AS effective_paid,
    -- Unclamped signed balance: > 0 means receivable due; < 0 means customer refund owed
    ((i.grand_total - COALESCE(ct.total_credited, 0.00))
        - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00)))::NUMERIC(12, 2) AS signed_balance,
    CASE
        WHEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))) > 0.00
        THEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00)))::NUMERIC(12, 2)
        ELSE 0.00::NUMERIC(12, 2)
    END AS balance_due,
    CASE
        WHEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))) < 0.00
        THEN ABS((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00)))::NUMERIC(12, 2)
        ELSE 0.00::NUMERIC(12, 2)
    END AS refund_due_to_customer,
    CASE
        WHEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))) < 0.00
            THEN 'REFUND_DUE'
        WHEN i.status = 'CANCELLED'
            THEN 'CANCELLED'
        WHEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))) = 0.00
            THEN 'PAID'
        WHEN (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00)) = 0.00
            THEN 'UNPAID'
        ELSE 'PARTIALLY_PAID'
    END AS payment_status,
    i.status AS invoice_status,
    i.issued_by_user_id,
    i.issued_at,
    DATE(i.issued_at AT TIME ZONE 'Asia/Colombo') AS business_date,
    i.vehicle_category,
    i.unit_snapshot
FROM invoices i
LEFT JOIN payment_totals pt ON pt.invoice_id = i.id
LEFT JOIN adjustment_totals at ON at.invoice_id = i.id
LEFT JOIN credit_totals ct ON ct.invoice_id = i.id
WHERE i.status IN ('ISSUED', 'CANCELLED');

ALTER VIEW invoice_ledger_view SET (security_invoker = true);

-- 7. Enable Row-Level Security & Lock Down Access
ALTER TABLE public.material_vehicle_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_vehicle_price_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.material_vehicle_prices, public.material_vehicle_price_history FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.material_vehicle_prices_id_seq, public.material_vehicle_price_history_id_seq FROM PUBLIC;

DO $$
DECLARE
    v_role TEXT;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.material_vehicle_prices, public.material_vehicle_price_history FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON SEQUENCE public.material_vehicle_prices_id_seq, public.material_vehicle_price_history_id_seq FROM %I', v_role);
        END IF;
    END LOOP;
END
$$;

-- 8. Configure Least-Privilege Grants & RLS Policies for Runtime Role (npr_app_user)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npr_app_user') THEN
        GRANT USAGE, SELECT ON SEQUENCE
            public.material_vehicle_prices_id_seq,
            public.material_vehicle_price_history_id_seq
        TO npr_app_user;

        GRANT SELECT, INSERT, UPDATE ON public.material_vehicle_prices TO npr_app_user;
        GRANT SELECT, INSERT ON public.material_vehicle_price_history TO npr_app_user;

        DROP POLICY IF EXISTS app_mat_veh_prices_select ON public.material_vehicle_prices;
        DROP POLICY IF EXISTS app_mat_veh_prices_insert ON public.material_vehicle_prices;
        DROP POLICY IF EXISTS app_mat_veh_prices_update ON public.material_vehicle_prices;

        CREATE POLICY app_mat_veh_prices_select ON public.material_vehicle_prices
            FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_mat_veh_prices_insert ON public.material_vehicle_prices
            FOR INSERT TO npr_app_user WITH CHECK (true);
        CREATE POLICY app_mat_veh_prices_update ON public.material_vehicle_prices
            FOR UPDATE TO npr_app_user USING (true) WITH CHECK (true);

        DROP POLICY IF EXISTS app_mat_veh_price_history_select ON public.material_vehicle_price_history;
        DROP POLICY IF EXISTS app_mat_veh_price_history_insert ON public.material_vehicle_price_history;

        CREATE POLICY app_mat_veh_price_history_select ON public.material_vehicle_price_history
            FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_mat_veh_price_history_insert ON public.material_vehicle_price_history
            FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.users u
                    WHERE u.id = changed_by_user_id AND u.role IN ('OWNER', 'CASHIER') AND u.is_active = true
                )
            );
    END IF;
END
$$;
