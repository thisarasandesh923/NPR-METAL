-- =============================================================================
-- Manual DBA Script: Apply Least-Privilege Grants & RLS Policies to npr_app_user
-- Project: NPR Metal Crusher — Billing & Management System
-- Prerequisites (Execute manually by DBA prior to running this script; NEVER
-- commit real passwords):
--   CREATE ROLE npr_app_user WITH
--     LOGIN
--     PASSWORD '<STRONG_RANDOM_PASSWORD>'
--     NOSUPERUSER
--     NOCREATEDB
--     NOCREATEROLE
--     NOREPLICATION
--     NOBYPASSRLS;
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npr_app_user') THEN
        RAISE EXCEPTION 'Role "npr_app_user" does not exist. Create it with NOSUPERUSER NOBYPASSRLS first.';
    END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM npr_app_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM npr_app_user;
REVOKE ALL ON FUNCTION
    set_updated_at(), forbid_append_only_mutation(), enforce_price_history_owner(),
    enforce_invoice_before_insert(), enforce_invoice_before_update(), forbid_invoice_delete(),
    verify_invoice_finalized_on_commit(), enforce_invoice_item_immutability(),
    enforce_payment_insert_bounds(), enforce_payment_adjustment_bounds(),
    enforce_credit_note_bounds(), verify_credit_note_resolution_on_commit()
FROM npr_app_user;

GRANT USAGE ON SCHEMA public TO npr_app_user;

-- 1. Minimal Sequence Access
GRANT USAGE, SELECT ON SEQUENCE
    invoice_number_seq,
    receipt_number_seq,
    adjustment_number_seq,
    credit_note_number_seq,
    customers_id_seq,
    materials_id_seq,
    material_price_history_id_seq,
    invoices_id_seq,
    invoice_items_id_seq,
    payments_id_seq,
    payment_adjustments_id_seq,
    credit_notes_id_seq,
    audit_logs_id_seq
TO npr_app_user;

-- 2. Column-Restricted & Append-Only Table Grants (NO DELETE on financial/identity tables)
GRANT SELECT ON users TO npr_app_user;
GRANT UPDATE (password_hash, full_name, is_active, updated_at) ON users TO npr_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO npr_app_user;

GRANT SELECT, INSERT ON customers TO npr_app_user;
GRANT UPDATE (name, phone, location, notes, updated_at) ON customers TO npr_app_user;

GRANT SELECT ON materials TO npr_app_user;
GRANT UPDATE (name, current_unit_price, is_active, updated_at) ON materials TO npr_app_user;
GRANT SELECT, INSERT ON material_price_history TO npr_app_user;

GRANT SELECT, INSERT ON invoices TO npr_app_user;
GRANT UPDATE (subtotal, grand_total, status, issued_at) ON invoices TO npr_app_user;
GRANT SELECT, INSERT ON invoice_items TO npr_app_user;
GRANT SELECT, INSERT ON payments TO npr_app_user;
GRANT SELECT, INSERT ON payment_adjustments TO npr_app_user;
GRANT SELECT, INSERT ON credit_notes TO npr_app_user;
GRANT SELECT, INSERT ON audit_logs TO npr_app_user;
GRANT SELECT, INSERT, DELETE ON idempotency_records TO npr_app_user;

-- 3. Reporting Views (Read-Only, security_invoker = true)
GRANT SELECT ON
    invoice_ledger_view,
    daily_cash_reconciliation_view,
    cashier_shift_reconciliation_view,
    customer_balances_view
TO npr_app_user;

-- 4. Operation-Scoped Row-Level Security Policies (Compatible with NOBYPASSRLS)
DROP POLICY IF EXISTS app_users_select ON users;
DROP POLICY IF EXISTS app_users_update ON users;
CREATE POLICY app_users_select ON users FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_users_update ON users FOR UPDATE TO npr_app_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS app_sessions_select ON user_sessions;
DROP POLICY IF EXISTS app_sessions_insert ON user_sessions;
DROP POLICY IF EXISTS app_sessions_update ON user_sessions;
DROP POLICY IF EXISTS app_sessions_delete ON user_sessions;
CREATE POLICY app_sessions_select ON user_sessions FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_sessions_insert ON user_sessions FOR INSERT TO npr_app_user WITH CHECK (true);
CREATE POLICY app_sessions_update ON user_sessions FOR UPDATE TO npr_app_user USING (true) WITH CHECK (true);
CREATE POLICY app_sessions_delete ON user_sessions FOR DELETE TO npr_app_user USING (true);

DROP POLICY IF EXISTS app_customers_select ON customers;
DROP POLICY IF EXISTS app_customers_insert ON customers;
DROP POLICY IF EXISTS app_customers_update ON customers;
CREATE POLICY app_customers_select ON customers FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_customers_insert ON customers FOR INSERT TO npr_app_user WITH CHECK (true);
CREATE POLICY app_customers_update ON customers FOR UPDATE TO npr_app_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS app_materials_select ON materials;
DROP POLICY IF EXISTS app_materials_update ON materials;
CREATE POLICY app_materials_select ON materials FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_materials_update ON materials FOR UPDATE TO npr_app_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS app_price_history_select ON material_price_history;
DROP POLICY IF EXISTS app_price_history_insert ON material_price_history;
CREATE POLICY app_price_history_select ON material_price_history FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_price_history_insert ON material_price_history FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = changed_by_user_id AND u.role = 'OWNER' AND u.is_active = true
        )
    );

DROP POLICY IF EXISTS app_invoices_select ON invoices;
DROP POLICY IF EXISTS app_invoices_insert ON invoices;
DROP POLICY IF EXISTS app_invoices_update ON invoices;
CREATE POLICY app_invoices_select ON invoices FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_invoices_insert ON invoices FOR INSERT TO npr_app_user WITH CHECK (status = 'DRAFT');
CREATE POLICY app_invoices_update ON invoices FOR UPDATE TO npr_app_user
    USING (status IN ('DRAFT', 'ISSUED'))
    WITH CHECK (status IN ('ISSUED', 'CANCELLED'));

DROP POLICY IF EXISTS app_invoice_items_select ON invoice_items;
DROP POLICY IF EXISTS app_invoice_items_insert ON invoice_items;
CREATE POLICY app_invoice_items_select ON invoice_items FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_invoice_items_insert ON invoice_items FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM invoices i WHERE i.id = invoice_id AND i.status = 'DRAFT'
        )
    );

DROP POLICY IF EXISTS app_payments_select ON payments;
DROP POLICY IF EXISTS app_payments_insert ON payments;
CREATE POLICY app_payments_select ON payments FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_payments_insert ON payments FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM invoices i WHERE i.id = invoice_id AND i.status = 'ISSUED'
        )
    );

DROP POLICY IF EXISTS app_payment_adjustments_select ON payment_adjustments;
DROP POLICY IF EXISTS app_payment_adjustments_insert ON payment_adjustments;
CREATE POLICY app_payment_adjustments_select ON payment_adjustments FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_payment_adjustments_insert ON payment_adjustments FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = authorized_by_owner_id AND u.role = 'OWNER' AND u.is_active = true
        )
    );

DROP POLICY IF EXISTS app_credit_notes_select ON credit_notes;
DROP POLICY IF EXISTS app_credit_notes_insert ON credit_notes;
CREATE POLICY app_credit_notes_select ON credit_notes FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_credit_notes_insert ON credit_notes FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = authorized_by_owner_id AND u.role = 'OWNER' AND u.is_active = true
        )
    );

DROP POLICY IF EXISTS app_idempotency_select ON idempotency_records;
DROP POLICY IF EXISTS app_idempotency_insert ON idempotency_records;
DROP POLICY IF EXISTS app_idempotency_delete ON idempotency_records;
CREATE POLICY app_idempotency_select ON idempotency_records FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_idempotency_insert ON idempotency_records FOR INSERT TO npr_app_user WITH CHECK (true);
CREATE POLICY app_idempotency_delete ON idempotency_records FOR DELETE TO npr_app_user
    USING (expires_at < NOW());

DROP POLICY IF EXISTS app_audit_logs_select ON audit_logs;
DROP POLICY IF EXISTS app_audit_logs_insert ON audit_logs;
CREATE POLICY app_audit_logs_select ON audit_logs FOR SELECT TO npr_app_user USING (true);
CREATE POLICY app_audit_logs_insert ON audit_logs FOR INSERT TO npr_app_user WITH CHECK (true);
