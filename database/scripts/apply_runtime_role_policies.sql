-- =============================================================================
-- Manual DBA Script: Apply Least-Privilege Grants & RLS Policies to npr_app_user
-- Project: NPR Metal Crusher — Billing & Management System
-- Execution Order: Run ONLY after migrations 001-006 are applied.
-- Recommended Staged Prerequisites (create NOLOGIN first, verify policies,
-- set SCRAM-SHA-256 password out-of-band without shell/SQL logs, then LOGIN):
--   CREATE ROLE npr_app_user WITH
--     NOLOGIN
--     NOSUPERUSER
--     NOCREATEDB
--     NOCREATEROLE
--     NOREPLICATION
--     NOINHERIT
--     NOBYPASSRLS;
-- Supavisor Session Pooler username format (port 5432):
--   npr_app_user.<PROJECT_REF>
-- =============================================================================

BEGIN;

-- 0. Fail-Closed Preflight Verification (Role Attributes, Membership, Ownership & Migration 006 State)
DO $$
DECLARE
    v_role RECORD;
    v_member_count INT;
    v_owned_rel_count INT;
    v_owned_proc_count INT;
    v_tbl TEXT;
    v_view TEXT;
    v_has_rls BOOLEAN;
    v_view_opts TEXT[];
    v_secdef BOOLEAN;
    v_proconfig TEXT[];
BEGIN
    SELECT oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    INTO v_role
    FROM pg_roles
    WHERE rolname = 'npr_app_user';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Role "npr_app_user" does not exist. Create it with NOSUPERUSER NOBYPASSRLS NOINHERIT first.';
    END IF;

    IF NOT v_role.rolcanlogin THEN
        RAISE NOTICE 'Role "npr_app_user" is in staged NOLOGIN mode; set SCRAM-SHA-256 password and enable LOGIN only after verifying grants and RLS.';
    END IF;

    IF v_role.rolsuper OR v_role.rolcreatedb OR v_role.rolcreaterole OR v_role.rolreplication OR v_role.rolbypassrls THEN
        RAISE EXCEPTION 'Role "npr_app_user" has unsafe elevated attributes (expected NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS).';
    END IF;

    SELECT COUNT(*) INTO v_member_count
    FROM pg_auth_members
    WHERE member = v_role.oid;

    IF v_member_count > 0 THEN
        RAISE EXCEPTION 'Role "npr_app_user" must not belong to any parent roles (found % role memberships).', v_member_count;
    END IF;

    SELECT COUNT(*) INTO v_owned_rel_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relowner = v_role.oid;

    SELECT COUNT(*) INTO v_owned_proc_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proowner = v_role.oid;

    IF v_owned_rel_count > 0 OR v_owned_proc_count > 0 THEN
        RAISE EXCEPTION 'Role "npr_app_user" must not own schema objects in public (relations=%, functions=%).',
            v_owned_rel_count, v_owned_proc_count;
    END IF;

    FOREACH v_tbl IN ARRAY ARRAY[
        'users', 'user_sessions', 'customers', 'materials', 'material_price_history',
        'invoices', 'invoice_items', 'payments', 'payment_adjustments',
        'credit_notes', 'idempotency_records', 'audit_logs'
    ]
    LOOP
        SELECT c.relrowsecurity INTO v_has_rls
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relkind = 'r';

        IF v_has_rls IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Unexpected schema state: table public.% is missing or lacks RLS (apply migrations 001-006 first).', v_tbl;
        END IF;
    END LOOP;

    FOREACH v_view IN ARRAY ARRAY[
        'invoice_ledger_view',
        'daily_cash_reconciliation_view',
        'cashier_shift_reconciliation_view',
        'customer_balances_view'
    ]
    LOOP
        SELECT c.reloptions INTO v_view_opts
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = v_view AND c.relkind = 'v';

        IF v_view_opts IS NULL OR NOT ('security_invoker=true' = ANY(v_view_opts)) THEN
            RAISE EXCEPTION 'Unexpected schema state: view public.% is missing security_invoker=true (apply migration 006 first).', v_view;
        END IF;
    END LOOP;

    SELECT p.prosecdef, p.proconfig INTO v_secdef, v_proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enforce_payment_adjustment_bounds';

    IF v_secdef IS DISTINCT FROM true
       OR v_proconfig IS NULL
       OR NOT ('search_path=pg_catalog, pg_temp' = ANY(v_proconfig)) THEN
        RAISE EXCEPTION 'Unexpected schema state: public.enforce_payment_adjustment_bounds() lacks migration 006 SECURITY DEFINER hardening.';
    END IF;
END
$$;

-- 1. Clean Baseline Reset & Schema Hardening
REVOKE CREATE ON SCHEMA public FROM npr_app_user;
GRANT USAGE ON SCHEMA public TO npr_app_user;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM npr_app_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM npr_app_user;

DO $$
BEGIN
    IF to_regclass('public.pgmigrations') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.pgmigrations FROM npr_app_user;
    END IF;
END
$$;

REVOKE ALL ON FUNCTION
    set_updated_at(), forbid_append_only_mutation(), enforce_price_history_owner(),
    enforce_invoice_before_insert(), enforce_invoice_before_update(), forbid_invoice_delete(),
    verify_invoice_finalized_on_commit(), enforce_invoice_item_immutability(),
    enforce_payment_insert_bounds(), enforce_payment_adjustment_bounds(),
    enforce_credit_note_bounds(), verify_credit_note_resolution_on_commit()
FROM npr_app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM npr_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM npr_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM npr_app_user;

-- 2. Minimal Sequence Access (Strictly tables with INSERT privilege; excludes materials_id_seq & pgmigrations_id_seq)
GRANT USAGE, SELECT ON SEQUENCE
    invoice_number_seq,
    receipt_number_seq,
    adjustment_number_seq,
    credit_note_number_seq,
    customers_id_seq,
    material_price_history_id_seq,
    invoices_id_seq,
    invoice_items_id_seq,
    payments_id_seq,
    payment_adjustments_id_seq,
    credit_notes_id_seq,
    audit_logs_id_seq
TO npr_app_user;

-- 3. Column-Restricted & Append-Only Table Grants (NO DELETE on financial/identity tables)
GRANT SELECT ON users TO npr_app_user;
GRANT UPDATE (password_hash, full_name, is_active, updated_at) ON users TO npr_app_user;

GRANT SELECT, INSERT, DELETE ON user_sessions TO npr_app_user;
GRANT UPDATE (ip_address, user_agent, expires_at) ON user_sessions TO npr_app_user;

GRANT SELECT, INSERT ON customers TO npr_app_user;
GRANT UPDATE (name, phone, location, notes, updated_at) ON customers TO npr_app_user;

GRANT SELECT ON materials TO npr_app_user;
GRANT UPDATE (name, current_unit_price, is_active, updated_at) ON materials TO npr_app_user;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'version'
    ) THEN
        GRANT UPDATE (version) ON materials TO npr_app_user;
    END IF;
END
$$;
GRANT SELECT, INSERT ON material_price_history TO npr_app_user;

GRANT SELECT, INSERT ON invoices TO npr_app_user;
GRANT UPDATE (subtotal, grand_total, status, issued_at) ON invoices TO npr_app_user;
GRANT SELECT, INSERT ON invoice_items TO npr_app_user;
GRANT SELECT, INSERT ON payments TO npr_app_user;
GRANT SELECT, INSERT ON payment_adjustments TO npr_app_user;
GRANT SELECT, INSERT ON credit_notes TO npr_app_user;
GRANT SELECT, INSERT ON audit_logs TO npr_app_user;
GRANT SELECT, INSERT, DELETE ON idempotency_records TO npr_app_user;

-- 4. Reporting Views (Read-Only, security_invoker = true)
GRANT SELECT ON
    invoice_ledger_view,
    daily_cash_reconciliation_view,
    cashier_shift_reconciliation_view,
    customer_balances_view
TO npr_app_user;

-- 5. Operation-Scoped Row-Level Security Policies (Compatible with NOBYPASSRLS)
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
            WHERE u.id = changed_by_user_id AND u.role IN ('OWNER', 'CASHIER') AND u.is_active = true
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

-- 6. Conditional Grants & RLS Policies for Migration 008 Objects (Operations & Payroll)
DO $$
BEGIN
    IF to_regclass('public.workers') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION
            enforce_operational_approval_transition(),
            enforce_owner_actor_for_finance(),
            enforce_salary_payment_bounds()
        FROM npr_app_user;

        IF to_regprocedure('enforce_payroll_period_immutability()') IS NOT NULL THEN
            REVOKE ALL ON FUNCTION enforce_payroll_period_immutability() FROM npr_app_user;
        END IF;

        GRANT USAGE, SELECT ON SEQUENCE
            advance_number_seq,
            salary_receipt_number_seq,
            expense_number_seq,
            workers_id_seq,
            worker_compensation_profiles_id_seq,
            worker_attendance_id_seq,
            machines_id_seq,
            machine_work_logs_id_seq,
            production_logs_id_seq,
            operational_approval_history_id_seq,
            payroll_periods_id_seq,
            payroll_entries_id_seq,
            worker_advances_id_seq,
            salary_payments_id_seq,
            operational_expenses_id_seq
        TO npr_app_user;

        GRANT SELECT, INSERT, UPDATE ON
            workers,
            worker_compensation_profiles,
            worker_attendance,
            machines,
            machine_work_logs,
            production_logs,
            payroll_periods,
            payroll_entries
        TO npr_app_user;

        GRANT SELECT, INSERT ON
            operational_approval_history,
            worker_advances,
            salary_payments,
            operational_expenses
        TO npr_app_user;

        DROP POLICY IF EXISTS app_workers_all ON workers;
        CREATE POLICY app_workers_all ON workers FOR ALL TO npr_app_user USING (true) WITH CHECK (true);

        DROP POLICY IF EXISTS app_worker_comp_all ON worker_compensation_profiles;
        CREATE POLICY app_worker_comp_all ON worker_compensation_profiles FOR ALL TO npr_app_user
            USING (true)
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = updated_by_owner_id AND u.role IN ('OWNER', 'CASHIER') AND u.is_active = true
                )
            );

        DROP POLICY IF EXISTS app_worker_attendance_all ON worker_attendance;
        CREATE POLICY app_worker_attendance_all ON worker_attendance FOR ALL TO npr_app_user USING (true) WITH CHECK (true);

        DROP POLICY IF EXISTS app_machines_all ON machines;
        CREATE POLICY app_machines_all ON machines FOR ALL TO npr_app_user USING (true) WITH CHECK (true);

        DROP POLICY IF EXISTS app_machine_logs_all ON machine_work_logs;
        CREATE POLICY app_machine_logs_all ON machine_work_logs FOR ALL TO npr_app_user USING (true) WITH CHECK (true);

        DROP POLICY IF EXISTS app_production_logs_all ON production_logs;
        CREATE POLICY app_production_logs_all ON production_logs FOR ALL TO npr_app_user USING (true) WITH CHECK (true);

        DROP POLICY IF EXISTS app_op_history_select ON operational_approval_history;
        DROP POLICY IF EXISTS app_op_history_insert ON operational_approval_history;
        CREATE POLICY app_op_history_select ON operational_approval_history FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_op_history_insert ON operational_approval_history FOR INSERT TO npr_app_user WITH CHECK (true);

        DROP POLICY IF EXISTS app_payroll_periods_all ON payroll_periods;
        DROP POLICY IF EXISTS app_payroll_periods_select ON payroll_periods;
        DROP POLICY IF EXISTS app_payroll_periods_insert ON payroll_periods;
        DROP POLICY IF EXISTS app_payroll_periods_update ON payroll_periods;
        CREATE POLICY app_payroll_periods_select ON payroll_periods FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_payroll_periods_insert ON payroll_periods FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = created_by_owner_id AND u.role IN ('OWNER', 'CASHIER') AND u.is_active = true
                )
            );
        CREATE POLICY app_payroll_periods_update ON payroll_periods FOR UPDATE TO npr_app_user
            USING (true)
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = created_by_owner_id AND u.role IN ('OWNER', 'CASHIER') AND u.is_active = true
                )
                AND (
                    approved_by_owner_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM users u
                        WHERE u.id = approved_by_owner_id AND u.role = 'OWNER' AND u.is_active = true
                    )
                )
            );

        DROP POLICY IF EXISTS app_payroll_entries_all ON payroll_entries;
        CREATE POLICY app_payroll_entries_all ON payroll_entries FOR ALL TO npr_app_user USING (true) WITH CHECK (true);

        DROP POLICY IF EXISTS app_worker_advances_select ON worker_advances;
        DROP POLICY IF EXISTS app_worker_advances_insert ON worker_advances;
        CREATE POLICY app_worker_advances_select ON worker_advances FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_worker_advances_insert ON worker_advances FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = authorized_by_owner_id AND u.role IN ('OWNER', 'CASHIER') AND u.is_active = true
                )
            );

        DROP POLICY IF EXISTS app_salary_payments_select ON salary_payments;
        DROP POLICY IF EXISTS app_salary_payments_insert ON salary_payments;
        CREATE POLICY app_salary_payments_select ON salary_payments FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_salary_payments_insert ON salary_payments FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = paid_by_owner_id AND u.role IN ('OWNER', 'CASHIER') AND u.is_active = true
                )
            );

        DROP POLICY IF EXISTS app_expenses_select ON operational_expenses;
        DROP POLICY IF EXISTS app_expenses_insert ON operational_expenses;
        CREATE POLICY app_expenses_select ON operational_expenses FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_expenses_insert ON operational_expenses FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = recorded_by_owner_id AND u.role IN ('OWNER', 'CASHIER') AND u.is_active = true
                )
            );

        IF to_regclass('public.salary_payment_adjustments') IS NOT NULL THEN
            REVOKE ALL ON FUNCTION enforce_salary_payment_adjustment_bounds() FROM npr_app_user;

            GRANT USAGE, SELECT ON SEQUENCE salary_adjustment_number_seq TO npr_app_user;
            GRANT USAGE, SELECT ON SEQUENCE salary_payment_adjustments_id_seq TO npr_app_user;
            GRANT SELECT, INSERT ON salary_payment_adjustments TO npr_app_user;

            DROP POLICY IF EXISTS app_salary_payment_adjustments_select ON salary_payment_adjustments;
            CREATE POLICY app_salary_payment_adjustments_select ON salary_payment_adjustments
                FOR SELECT TO npr_app_user USING (true);

            DROP POLICY IF EXISTS app_salary_payment_adjustments_insert ON salary_payment_adjustments;
            CREATE POLICY app_salary_payment_adjustments_insert ON salary_payment_adjustments
                FOR INSERT TO npr_app_user
                WITH CHECK (
                    EXISTS (
                        SELECT 1 FROM users u
                        WHERE u.id = authorized_by_owner_id AND u.role = 'OWNER' AND u.is_active = true
                    )
                );
        END IF;
    END IF;
END
$$;

-- 7. Conditional Grants & RLS Policies for Migration 015 Objects (Vehicle-based ft³ Pricing)
DO $$
BEGIN
    IF to_regclass('public.material_vehicle_prices') IS NOT NULL THEN
        GRANT USAGE, SELECT ON SEQUENCE
            material_vehicle_prices_id_seq,
            material_vehicle_price_history_id_seq
        TO npr_app_user;

        GRANT SELECT, INSERT, UPDATE ON material_vehicle_prices TO npr_app_user;
        GRANT SELECT, INSERT ON material_vehicle_price_history TO npr_app_user;

        DROP POLICY IF EXISTS app_mat_veh_prices_select ON material_vehicle_prices;
        DROP POLICY IF EXISTS app_mat_veh_prices_insert ON material_vehicle_prices;
        DROP POLICY IF EXISTS app_mat_veh_prices_update ON material_vehicle_prices;

        CREATE POLICY app_mat_veh_prices_select ON material_vehicle_prices
            FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_mat_veh_prices_insert ON material_vehicle_prices
            FOR INSERT TO npr_app_user WITH CHECK (true);
        CREATE POLICY app_mat_veh_prices_update ON material_vehicle_prices
            FOR UPDATE TO npr_app_user USING (true) WITH CHECK (true);

        DROP POLICY IF EXISTS app_mat_veh_price_history_select ON material_vehicle_price_history;
        DROP POLICY IF EXISTS app_mat_veh_price_history_insert ON material_vehicle_price_history;

        CREATE POLICY app_mat_veh_price_history_select ON material_vehicle_price_history
            FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_mat_veh_price_history_insert ON material_vehicle_price_history
            FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = changed_by_user_id AND u.role IN ('OWNER', 'CASHIER') AND u.is_active = true
                )
            );
    END IF;
END
$$;

COMMIT;