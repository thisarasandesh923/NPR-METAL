-- Up Migration
-- =============================================================================
-- Migration 010: Allow Cashier Material Price Updates & Preserve Audit History
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • Approved Business Rule: Both OWNER and CASHIER can immediately update
--     material selling prices without waiting for Owner approval.
--   • Every price change performed by a Cashier is permanently recorded in
--     material_price_history and audit_logs, visible to the Owner.
--   • Updates the trigger function enforce_price_history_owner to permit
--     active accounts with role 'OWNER' or 'CASHIER'.
--   • Keeps material activation/deactivation strictly Owner-only.
--   • Preserves strict append-only constraints and historical immutability.
-- =============================================================================

CREATE OR REPLACE FUNCTION enforce_price_history_owner()
RETURNS TRIGGER AS $$
DECLARE
    v_authorizer_role VARCHAR(20);
    v_authorizer_active BOOLEAN;
BEGIN
    SELECT role, is_active INTO v_authorizer_role, v_authorizer_active
    FROM users WHERE id = NEW.changed_by_user_id;

    IF v_authorizer_role NOT IN ('OWNER', 'CASHIER') OR v_authorizer_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER or CASHIER accounts are permitted to alter material prices';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
