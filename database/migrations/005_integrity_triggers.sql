-- Up Migration
-- =============================================================================
-- Migration 005: Financial Integrity, Lifecycle & Immutability Triggers
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • Enforces atomic DRAFT -> ISSUED invoice lifecycle; prevents unfinalized drafts.
--   • Locks invoice_items against INSERT/UPDATE/DELETE once finalized.
--   • Enforces strictly append-only financial and audit ledgers.
--   • Uses canonical top-down lock ordering (invoices -> payments) to prevent
--     concurrent overpayments and deadlocks.
--   • Normal application database role cannot disable or bypass triggers.
-- =============================================================================

-- 1. Generic Updated Timestamp Maintenance
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_set_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_customers_set_updated_at
    BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_materials_set_updated_at
    BEFORE UPDATE ON materials FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Shared Append-Only Enforcement Function
CREATE OR REPLACE FUNCTION forbid_append_only_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table "%" is strictly append-only; % operations are prohibited', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_material_price_history_append_only
    BEFORE UPDATE OR DELETE ON material_price_history
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER trg_payments_append_only
    BEFORE UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER trg_payment_adjustments_append_only
    BEFORE UPDATE OR DELETE ON payment_adjustments
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER trg_credit_notes_append_only
    BEFORE UPDATE OR DELETE ON credit_notes
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER trg_audit_logs_append_only
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER trg_idempotency_records_immutable_update
    BEFORE UPDATE ON idempotency_records
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

-- Verify only active OWNER accounts can log material price changes
CREATE OR REPLACE FUNCTION enforce_price_history_owner()
RETURNS TRIGGER AS $$
DECLARE
    v_authorizer_role VARCHAR(20);
    v_authorizer_active BOOLEAN;
BEGIN
    SELECT role, is_active INTO v_authorizer_role, v_authorizer_active
    FROM users WHERE id = NEW.changed_by_user_id;

    IF v_authorizer_role IS DISTINCT FROM 'OWNER' OR v_authorizer_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER accounts are permitted to alter material prices';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_material_price_history_owner
    BEFORE INSERT ON material_price_history
    FOR EACH ROW EXECUTE FUNCTION enforce_price_history_owner();

-- 3. Invoice Issuance Lifecycle & Commercial Immutability Triggers
CREATE OR REPLACE FUNCTION enforce_invoice_before_insert()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'New invoices must be inserted with DRAFT status and finalized before commit';
    END IF;
    IF NEW.issued_at IS NOT NULL THEN
        RAISE EXCEPTION 'DRAFT invoices cannot specify issued_at prior to finalization';
    END IF;
    IF NEW.subtotal <> 0.00 THEN
        RAISE EXCEPTION 'DRAFT invoices must initialize subtotal to 0.00 prior to line item verification';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_before_insert
    BEFORE INSERT ON invoices
    FOR EACH ROW EXECUTE FUNCTION enforce_invoice_before_insert();

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
            NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
            RAISE EXCEPTION 'Invoice customer, number, and transport attributes cannot be altered during finalization';
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
            NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
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

CREATE TRIGGER trg_invoices_before_update
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION enforce_invoice_before_update();

CREATE OR REPLACE FUNCTION forbid_invoice_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Invoices cannot be deleted; issue an authorized credit note and cancel instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_before_delete
    BEFORE DELETE ON invoices
    FOR EACH ROW EXECUTE FUNCTION forbid_invoice_delete();

-- Prevent committing any incomplete DRAFT invoice
CREATE OR REPLACE FUNCTION verify_invoice_finalized_on_commit()
RETURNS TRIGGER AS $$
DECLARE
    v_current_status VARCHAR(20);
BEGIN
    SELECT status INTO v_current_status FROM invoices WHERE id = NEW.id;
    IF v_current_status = 'DRAFT' THEN
        RAISE EXCEPTION 'Transaction cannot commit with unfinalized DRAFT invoice (id: %)', NEW.id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_invoices_require_finalized_on_commit
    AFTER INSERT OR UPDATE ON invoices
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verify_invoice_finalized_on_commit();

-- 4. Line Item Immutability Trigger
-- Permits INSERT exclusively while parent invoice is DRAFT in current TX;
-- rejects INSERT after ISSUED/CANCELLED and rejects ALL UPDATE/DELETE unconditionally.
CREATE OR REPLACE FUNCTION enforce_invoice_item_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_inv_status VARCHAR(20);
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT status INTO v_inv_status
        FROM invoices
        WHERE id = NEW.invoice_id
        FOR UPDATE;

        IF v_inv_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'Cannot insert line items into finalized or missing invoice % (status: %)',
                NEW.invoice_id, COALESCE(v_inv_status, 'NOT_FOUND');
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Invoice line items are permanently immutable once created';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_items_lock
    BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
    FOR EACH ROW EXECUTE FUNCTION enforce_invoice_item_immutability();

-- 5. Cash Payment Bounds & Concurrency Serialization Trigger
CREATE OR REPLACE FUNCTION enforce_payment_insert_bounds()
RETURNS TRIGGER AS $$
DECLARE
    v_grand_total NUMERIC(12, 2);
    v_inv_status VARCHAR(20);
    v_credited NUMERIC(12, 2);
    v_gross_paid NUMERIC(12, 2);
    v_adjusted NUMERIC(12, 2);
    v_effective_total NUMERIC(12, 2);
    v_effective_paid NUMERIC(12, 2);
    v_remaining_balance NUMERIC(12, 2);
BEGIN
    -- Acquire exclusive lock on parent invoice first (canonical lock order)
    SELECT grand_total, status
    INTO v_grand_total, v_inv_status
    FROM invoices
    WHERE id = NEW.invoice_id
    FOR UPDATE;

    IF v_inv_status IS DISTINCT FROM 'ISSUED' THEN
        RAISE EXCEPTION 'Cash payments can only be recorded against ISSUED invoices (current status: %)',
            COALESCE(v_inv_status, 'NOT_FOUND');
    END IF;

    SELECT COALESCE(SUM(credit_amount), 0.00)::NUMERIC(12, 2)
    INTO v_credited
    FROM credit_notes
    WHERE invoice_id = NEW.invoice_id;

    SELECT COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2)
    INTO v_gross_paid
    FROM payments
    WHERE invoice_id = NEW.invoice_id;

    SELECT COALESCE(SUM(pa.adjustment_amount), 0.00)::NUMERIC(12, 2)
    INTO v_adjusted
    FROM payment_adjustments pa
    JOIN payments py ON py.id = pa.payment_id
    WHERE py.invoice_id = NEW.invoice_id;

    v_effective_total := v_grand_total - v_credited;
    v_effective_paid := v_gross_paid - v_adjusted;
    v_remaining_balance := v_effective_total - v_effective_paid;

    IF NEW.amount > v_remaining_balance THEN
        RAISE EXCEPTION 'Payment amount (%) exceeds effective outstanding balance (%) for invoice %',
            NEW.amount, v_remaining_balance, NEW.invoice_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_before_insert
    BEFORE INSERT ON payments
    FOR EACH ROW EXECUTE FUNCTION enforce_payment_insert_bounds();

-- 6. Payment Adjustments Bounds, Role & Concurrency Trigger
CREATE OR REPLACE FUNCTION enforce_payment_adjustment_bounds()
RETURNS TRIGGER AS $$
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
    FROM users WHERE id = NEW.authorized_by_owner_id;
    IF v_authorizer_role IS DISTINCT FROM 'OWNER' OR v_authorizer_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER accounts are permitted to authorize payment adjustments';
    END IF;

    SELECT role, is_active INTO v_performer_role, v_performer_active
    FROM users WHERE id = NEW.performed_by_user_id;
    IF v_performer_role IS NULL OR v_performer_role NOT IN ('OWNER', 'CASHIER') OR v_performer_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Payment adjustment performer (%) must be an active staff account', NEW.performed_by_user_id;
    END IF;

    SELECT invoice_id INTO v_invoice_id FROM payments WHERE id = NEW.payment_id;
    IF v_invoice_id IS NULL THEN
        RAISE EXCEPTION 'Referenced payment % does not exist', NEW.payment_id;
    END IF;

    -- Acquire locks in canonical top-down order: invoices -> payments
    PERFORM 1 FROM invoices WHERE id = v_invoice_id FOR UPDATE;
    SELECT amount INTO v_orig_amount FROM payments WHERE id = NEW.payment_id FOR UPDATE;

    SELECT COALESCE(SUM(adjustment_amount), 0.00)::NUMERIC(12, 2)
    INTO v_prior_adjusted
    FROM payment_adjustments
    WHERE payment_id = NEW.payment_id;

    IF v_prior_adjusted + NEW.adjustment_amount > v_orig_amount THEN
        RAISE EXCEPTION 'Total adjustments (%) cannot exceed original payment amount (%) for payment %',
            (v_prior_adjusted + NEW.adjustment_amount), v_orig_amount, NEW.payment_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_adjustments_before_insert
    BEFORE INSERT ON payment_adjustments
    FOR EACH ROW EXECUTE FUNCTION enforce_payment_adjustment_bounds();

-- 7. Credit Notes Bounds, Owner Verification & Excess Cash Resolution Triggers
CREATE OR REPLACE FUNCTION enforce_credit_note_bounds()
RETURNS TRIGGER AS $$
DECLARE
    v_authorizer_role VARCHAR(20);
    v_authorizer_active BOOLEAN;
    v_grand_total NUMERIC(12, 2);
    v_inv_status VARCHAR(20);
    v_prior_credited NUMERIC(12, 2);
BEGIN
    SELECT role, is_active INTO v_authorizer_role, v_authorizer_active
    FROM users WHERE id = NEW.authorized_by_owner_id;
    IF v_authorizer_role IS DISTINCT FROM 'OWNER' OR v_authorizer_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER accounts are permitted to issue credit notes';
    END IF;

    SELECT grand_total, status
    INTO v_grand_total, v_inv_status
    FROM invoices
    WHERE id = NEW.invoice_id
    FOR UPDATE;

    IF v_inv_status IS DISTINCT FROM 'ISSUED' THEN
        RAISE EXCEPTION 'Credit notes can only be issued against ISSUED invoices (current status: %)',
            COALESCE(v_inv_status, 'NOT_FOUND');
    END IF;

    SELECT COALESCE(SUM(credit_amount), 0.00)::NUMERIC(12, 2)
    INTO v_prior_credited
    FROM credit_notes
    WHERE invoice_id = NEW.invoice_id;

    IF v_prior_credited + NEW.credit_amount > v_grand_total THEN
        RAISE EXCEPTION 'Total credit notes (%) cannot exceed original invoice grand total (%)',
            (v_prior_credited + NEW.credit_amount), v_grand_total;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_credit_notes_before_insert
    BEFORE INSERT ON credit_notes
    FOR EACH ROW EXECUTE FUNCTION enforce_credit_note_bounds();

CREATE OR REPLACE FUNCTION verify_credit_note_resolution_on_commit()
RETURNS TRIGGER AS $$
DECLARE
    v_grand_total NUMERIC(12, 2);
    v_credited NUMERIC(12, 2);
    v_gross_paid NUMERIC(12, 2);
    v_adjusted NUMERIC(12, 2);
    v_effective_total NUMERIC(12, 2);
    v_effective_paid NUMERIC(12, 2);
BEGIN
    SELECT grand_total INTO v_grand_total FROM invoices WHERE id = NEW.invoice_id;

    SELECT COALESCE(SUM(credit_amount), 0.00)::NUMERIC(12, 2)
    INTO v_credited FROM credit_notes WHERE invoice_id = NEW.invoice_id;

    SELECT COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2)
    INTO v_gross_paid FROM payments WHERE invoice_id = NEW.invoice_id;

    SELECT COALESCE(SUM(pa.adjustment_amount), 0.00)::NUMERIC(12, 2)
    INTO v_adjusted
    FROM payment_adjustments pa
    JOIN payments py ON py.id = pa.payment_id
    WHERE py.invoice_id = NEW.invoice_id;

    v_effective_total := v_grand_total - v_credited;
    v_effective_paid := v_gross_paid - v_adjusted;

    IF v_effective_paid > v_effective_total THEN
        IF NEW.excess_cash_resolution <> 'PENDING_CUSTOMER_REFUND' THEN
            RAISE EXCEPTION 'Credit note % leaves effective cash paid (%) exceeding commercial liability (%) without an explicit PENDING_CUSTOMER_REFUND resolution',
                NEW.credit_note_number, v_effective_paid, v_effective_total;
        END IF;
    ELSE
        IF NEW.excess_cash_resolution = 'PENDING_CUSTOMER_REFUND' THEN
            RAISE EXCEPTION 'Credit note % specifies PENDING_CUSTOMER_REFUND even though collected cash (%) does not exceed liability (%)',
                NEW.credit_note_number, v_effective_paid, v_effective_total;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_credit_notes_verify_excess_resolution
    AFTER INSERT ON credit_notes
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verify_credit_note_resolution_on_commit();

-- 8. Conditional Least-Privilege Grants for Dedicated Runtime Application Role
-- Applied automatically if DBA has provisioned the least-privilege role 'npr_app_user'.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npr_app_user') THEN
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM npr_app_user;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM npr_app_user;

        GRANT USAGE ON SCHEMA public TO npr_app_user;

        -- Sequences required for server-generated document numbers & serial PKs
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

        -- Identity & Session Management (Cannot insert users or escalate roles at runtime)
        GRANT SELECT ON users TO npr_app_user;
        GRANT UPDATE (password_hash, full_name, is_active, updated_at) ON users TO npr_app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO npr_app_user;

        -- Customers & Catalog
        GRANT SELECT, INSERT ON customers TO npr_app_user;
        GRANT UPDATE (name, phone, location, notes, updated_at) ON customers TO npr_app_user;
        GRANT SELECT ON materials TO npr_app_user;
        GRANT UPDATE (name, current_unit_price, is_active, updated_at) ON materials TO npr_app_user;
        GRANT SELECT, INSERT ON material_price_history TO npr_app_user;

        -- Commercial Contracts & Append-Only Financial Ledgers (NO DELETE)
        GRANT SELECT, INSERT ON invoices TO npr_app_user;
        GRANT UPDATE (subtotal, grand_total, status, issued_at) ON invoices TO npr_app_user;
        GRANT SELECT, INSERT ON invoice_items TO npr_app_user;
        GRANT SELECT, INSERT ON payments TO npr_app_user;
        GRANT SELECT, INSERT ON payment_adjustments TO npr_app_user;
        GRANT SELECT, INSERT ON credit_notes TO npr_app_user;
        GRANT SELECT, INSERT ON audit_logs TO npr_app_user;

        -- Idempotency records (allows expired cleanup)
        GRANT SELECT, INSERT, DELETE ON idempotency_records TO npr_app_user;

        -- Reporting Views (Read-Only)
        GRANT SELECT ON
            invoice_ledger_view,
            daily_cash_reconciliation_view,
            cashier_shift_reconciliation_view,
            customer_balances_view
        TO npr_app_user;
    END IF;
END
$$;
