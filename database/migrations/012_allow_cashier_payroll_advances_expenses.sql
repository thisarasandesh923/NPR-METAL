-- Up Migration
-- =============================================================================
-- Migration 012: Allow Cashier Access to Compensation, Advances & Expenses
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • Approved Business Rule: Active OWNER and CASHIER accounts can immediately
--     update worker compensation rates, record salary advances, and record
--     operational expenses without requiring Owner approval.
--   • Updates trigger function enforce_owner_actor_for_finance() so active
--     OWNER and CASHIER accounts are permitted for:
--       - worker_compensation_profiles
--       - worker_advances
--       - operational_expenses
--   • Updates the corresponding Row-Level Security (RLS) policies on
--     npr_app_user:
--       - app_worker_comp_all
--       - app_worker_advances_insert
--       - app_expenses_insert
--   • Preserves strict Owner-only authorization for payroll approval and
--     salary disbursements (enforce_salary_payment_bounds).
--   • Preserves append-only immutability triggers on worker_advances and
--     operational_expenses (forbid_append_only_mutation).
--   • Keeps Row-Level Security (RLS) enabled on all affected tables.
-- =============================================================================

-- 1. Update Trigger Function to Permit Active OWNER and CASHIER
CREATE OR REPLACE FUNCTION enforce_owner_actor_for_finance()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_role VARCHAR(20);
    v_active BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'worker_compensation_profiles' THEN
        v_user_id := NEW.updated_by_owner_id;
    ELSIF TG_TABLE_NAME = 'worker_advances' THEN
        v_user_id := NEW.authorized_by_owner_id;
    ELSIF TG_TABLE_NAME = 'operational_expenses' THEN
        v_user_id := NEW.recorded_by_owner_id;
    END IF;

    SELECT role, is_active INTO v_role, v_active FROM public.users WHERE id = v_user_id;
    IF v_role NOT IN ('OWNER', 'CASHIER') OR v_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER or CASHIER accounts can perform operation on %', TG_TABLE_NAME;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Update Row-Level Security (RLS) Policies on npr_app_user
DROP POLICY IF EXISTS app_worker_comp_all ON public.worker_compensation_profiles;
CREATE POLICY app_worker_comp_all ON public.worker_compensation_profiles FOR ALL TO npr_app_user
    USING (true)
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = updated_by_owner_id
              AND u.role IN ('OWNER', 'CASHIER')
              AND u.is_active = true
        )
    );

DROP POLICY IF EXISTS app_worker_advances_insert ON public.worker_advances;
CREATE POLICY app_worker_advances_insert ON public.worker_advances FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = authorized_by_owner_id
              AND u.role IN ('OWNER', 'CASHIER')
              AND u.is_active = true
        )
    );

DROP POLICY IF EXISTS app_expenses_insert ON public.operational_expenses;
CREATE POLICY app_expenses_insert ON public.operational_expenses FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = recorded_by_owner_id
              AND u.role IN ('OWNER', 'CASHIER')
              AND u.is_active = true
        )
    );
