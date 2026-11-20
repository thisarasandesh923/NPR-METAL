-- Up Migration
-- =============================================================================
-- Migration 011: Allow Cashier Material Price History Insert in RLS Policy
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • Approved Business Rule: Active OWNER and CASHIER accounts can immediately
--     update material selling prices.
--   • Root Cause: Migration 010 updated trigger function enforce_price_history_owner
--     to permit both OWNER and CASHIER, but the table's Row-Level Security (RLS)
--     policy app_price_history_insert for role npr_app_user still permitted only
--     role 'OWNER'.
--   • Fix: Update the app_price_history_insert policy on public.material_price_history
--     for role npr_app_user to permit active users with role IN ('OWNER', 'CASHIER').
--   • Preserves existing policy name 'app_price_history_insert' and role 'npr_app_user'.
--   • Keeps Row-Level Security (RLS) enabled on public.material_price_history.
--   • Preserves existing SELECT permissions and append-only UPDATE/DELETE protections.
-- =============================================================================

DROP POLICY IF EXISTS app_price_history_insert ON public.material_price_history;

CREATE POLICY app_price_history_insert ON public.material_price_history
    FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = changed_by_user_id
              AND u.role IN ('OWNER', 'CASHIER')
              AND u.is_active = true
        )
    );
