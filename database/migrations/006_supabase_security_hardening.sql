-- Up Migration
-- =============================================================================
-- Migration 006: Supabase Public Schema Security Hardening, RLS & View Defense
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • Explicitly revokes PUBLIC, anon, and authenticated access from all
--     application tables, reporting views, sequences, functions, and pgmigrations.
--   • Sets security_invoker = true on all 4 reporting views (PG 15+) so views
--     never bypass underlying Row-Level Security using the view owner's role.
--   • Explicitly enables Row-Level Security (RLS) on all application tables
--     (idempotent alongside Supabase's ensure_rls event trigger).
--   • Tightens future DEFAULT PRIVILEGES for the schema owner in schema public
--     so subsequent migrations do not re-expose new objects to anon/authenticated.
--   • Conditionally configures least-privilege operation-scoped RLS policies
--     for npr_app_user (NOBYPASSRLS) when the runtime role exists.
-- =============================================================================

-- 1. Explicitly Enable Row-Level Security on All Application Tables (and pgmigrations)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF to_regclass('public.pgmigrations') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.pgmigrations ENABLE ROW LEVEL SECURITY';
        EXECUTE 'REVOKE ALL ON TABLE public.pgmigrations FROM PUBLIC';
    END IF;
END
$$;

-- 2. Harden All 4 Reporting Views (security_invoker = true + Zero PUBLIC Access)
ALTER VIEW invoice_ledger_view SET (security_invoker = true);
ALTER VIEW daily_cash_reconciliation_view SET (security_invoker = true);
ALTER VIEW cashier_shift_reconciliation_view SET (security_invoker = true);
ALTER VIEW customer_balances_view SET (security_invoker = true);

-- 2b. Minimal SECURITY DEFINER Hardening (Strict Least-Privilege Scope)
-- Only enforce_payment_adjustment_bounds() requires SECURITY DEFINER because it locks
-- public.payments (FOR UPDATE), whereas runtime role npr_app_user must hold ZERO UPDATE
-- privileges on append-only payments. All other trigger functions remain SECURITY INVOKER.
-- search_path excludes writable schemas (pg_catalog, pg_temp) and all tables are
-- explicitly schema-qualified. Direct EXECUTE is revoked from all non-owner roles.
CREATE OR REPLACE FUNCTION public.enforce_payment_adjustment_bounds()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_authorizer_role VARCHAR(20);
    v_authorizer_active BOOLEAN;
    v_performer_role VARCHAR(20);
    v_performer_active BOOLEAN;
    v_invoice_id BIGINT;
    v_orig_amount NUMERIC(12, 2);
    v_prior_adjusted NUMERIC(12, 2);
BEGIN
    SELECT role, is_active INTO v_authorizer_role, v_authorizer_active
    FROM public.users WHERE id = NEW.authorized_by_owner_id;
    IF v_authorizer_role IS DISTINCT FROM 'OWNER' OR v_authorizer_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER accounts are permitted to authorize payment adjustments';
    END IF;

    SELECT role, is_active INTO v_performer_role, v_performer_active
    FROM public.users WHERE id = NEW.performed_by_user_id;
    IF v_performer_role IS NULL OR v_performer_role NOT IN ('OWNER', 'CASHIER') OR v_performer_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Payment adjustment performer (%) must be an active staff account', NEW.performed_by_user_id;
    END IF;

    SELECT invoice_id INTO v_invoice_id FROM public.payments WHERE id = NEW.payment_id;
    IF v_invoice_id IS NULL THEN
        RAISE EXCEPTION 'Referenced payment % does not exist', NEW.payment_id;
    END IF;

    -- Acquire locks in canonical top-down order: invoices -> payments
    PERFORM 1 FROM public.invoices WHERE id = v_invoice_id FOR UPDATE;
    SELECT amount INTO v_orig_amount FROM public.payments WHERE id = NEW.payment_id FOR UPDATE;

    SELECT COALESCE(SUM(adjustment_amount), 0.00)::NUMERIC(12, 2)
    INTO v_prior_adjusted
    FROM public.payment_adjustments
    WHERE payment_id = NEW.payment_id;

    IF v_prior_adjusted + NEW.adjustment_amount > v_orig_amount THEN
        RAISE EXCEPTION 'Total adjustments (%) cannot exceed original payment amount (%) for payment %',
            (v_prior_adjusted + NEW.adjustment_amount), v_orig_amount, NEW.payment_id;
    END IF;

    RETURN NEW;
END;
$$;

-- 3. Revoke All Privileges from PUBLIC on Tables, Views, Sequences & Application Functions
REVOKE ALL ON TABLE
    users,
    user_sessions,
    customers,
    materials,
    material_price_history,
    invoices,
    invoice_items,
    payments,
    payment_adjustments,
    credit_notes,
    idempotency_records,
    audit_logs,
    invoice_ledger_view,
    daily_cash_reconciliation_view,
    cashier_shift_reconciliation_view,
    customer_balances_view
FROM PUBLIC;

REVOKE ALL ON SEQUENCE
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
FROM PUBLIC;

REVOKE ALL ON FUNCTION
    set_updated_at(),
    forbid_append_only_mutation(),
    enforce_price_history_owner(),
    enforce_invoice_before_insert(),
    enforce_invoice_before_update(),
    forbid_invoice_delete(),
    verify_invoice_finalized_on_commit(),
    enforce_invoice_item_immutability(),
    enforce_payment_insert_bounds(),
    enforce_payment_adjustment_bounds(),
    enforce_credit_note_bounds(),
    verify_credit_note_resolution_on_commit()
FROM PUBLIC;

-- 4. Revoke Existing Grants & Future Default Privileges from Supabase Client Roles (anon / authenticated)
DO $$
DECLARE
    v_role TEXT;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
            EXECUTE format(
                'REVOKE ALL ON TABLE
                    users, user_sessions, customers, materials, material_price_history,
                    invoices, invoice_items, payments, payment_adjustments, credit_notes,
                    idempotency_records, audit_logs,
                    invoice_ledger_view, daily_cash_reconciliation_view,
                    cashier_shift_reconciliation_view, customer_balances_view
                 FROM %I',
                v_role
            );

            IF to_regclass('public.pgmigrations') IS NOT NULL THEN
                EXECUTE format('REVOKE ALL ON TABLE public.pgmigrations FROM %I', v_role);
            END IF;

            EXECUTE format(
                'REVOKE ALL ON SEQUENCE
                    invoice_number_seq, receipt_number_seq, adjustment_number_seq, credit_note_number_seq,
                    customers_id_seq, materials_id_seq, material_price_history_id_seq,
                    invoices_id_seq, invoice_items_id_seq, payments_id_seq,
                    payment_adjustments_id_seq, credit_notes_id_seq, audit_logs_id_seq
                 FROM %I',
                v_role
            );

            EXECUTE format(
                'REVOKE ALL ON FUNCTION
                    set_updated_at(), forbid_append_only_mutation(), enforce_price_history_owner(),
                    enforce_invoice_before_insert(), enforce_invoice_before_update(), forbid_invoice_delete(),
                    verify_invoice_finalized_on_commit(), enforce_invoice_item_immutability(),
                    enforce_payment_insert_bounds(), enforce_payment_adjustment_bounds(),
                    enforce_credit_note_bounds(), verify_credit_note_resolution_on_commit()
                 FROM %I',
                v_role
            );

            -- Prevent future objects created by current migration role from being exposed
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
                current_user, v_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
                current_user, v_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',
                current_user, v_role
            );
        END IF;
    END LOOP;

    -- Also lock down future PUBLIC defaults for objects created by current migration role
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC',
        current_user
    );
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC',
        current_user
    );
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC',
        current_user
    );
END
$$;

-- 5. Conditionally Apply Least-Privilege RLS Policies & Grants for Runtime Role (npr_app_user)
-- Note: npr_app_user must be provisioned with NOBYPASSRLS, NOSUPERUSER, NOCREATEDB, NOCREATEROLE.
-- If npr_app_user is provisioned AFTER initial migration deployment, execute
-- database/scripts/apply_runtime_role_policies.sql as the schema owner.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npr_app_user') THEN
        -- Re-assert clean baseline grants (zero access to pgmigrations or direct trigger functions)
        IF to_regclass('public.pgmigrations') IS NOT NULL THEN
            REVOKE ALL ON TABLE public.pgmigrations FROM npr_app_user;
        END IF;

        REVOKE ALL ON FUNCTION
            set_updated_at(), forbid_append_only_mutation(), enforce_price_history_owner(),
            enforce_invoice_before_insert(), enforce_invoice_before_update(), forbid_invoice_delete(),
            verify_invoice_finalized_on_commit(), enforce_invoice_item_immutability(),
            enforce_payment_insert_bounds(), enforce_payment_adjustment_bounds(),
            enforce_credit_note_bounds(), verify_credit_note_resolution_on_commit()
        FROM npr_app_user;

        -- Drop prior policies if re-applied cleanly
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
        CREATE POLICY app_invoices_insert ON invoices FOR INSERT TO npr_app_user
            WITH CHECK (status = 'DRAFT');
        CREATE POLICY app_invoices_update ON invoices FOR UPDATE TO npr_app_user
            USING (status IN ('DRAFT', 'ISSUED'))
            WITH CHECK (status IN ('ISSUED', 'CANCELLED'));

        DROP POLICY IF EXISTS app_invoice_items_select ON invoice_items;
        DROP POLICY IF EXISTS app_invoice_items_insert ON invoice_items;
        CREATE POLICY app_invoice_items_select ON invoice_items FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_invoice_items_insert ON invoice_items FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM invoices i
                    WHERE i.id = invoice_id AND i.status = 'DRAFT'
                )
            );

        DROP POLICY IF EXISTS app_payments_select ON payments;
        DROP POLICY IF EXISTS app_payments_insert ON payments;
        CREATE POLICY app_payments_select ON payments FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_payments_insert ON payments FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM invoices i
                    WHERE i.id = invoice_id AND i.status = 'ISSUED'
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
    END IF;
END
$$;
