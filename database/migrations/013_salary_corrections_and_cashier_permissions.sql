-- Up Migration
-- =============================================================================
-- Migration 013: Salary Corrections & Cashier Payment Permissions
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • Introduces salary_payment_adjustments as a strictly append-only ledger
--     (no updates, no physical deletions).
--   • Derives the latest effective payment amount using stable sequential ID ordering
--     (ORDER BY id DESC LIMIT 1) without mutable status flags.
--   • Supports repeated corrections (e.g., 30000 -> 25000 -> 20000) and voids
--     (e.g., 20000 -> 0).
--   • Permanently forbids further adjustments once a payment is marked VOID.
--   • Enforces strict concurrency safety and deadlock elimination via consistent
--     hierarchical row-level locks (Parent: payroll_entries FOR UPDATE -> Child:
--     salary_payments FOR UPDATE).
--   • Updates enforce_salary_payment_bounds() to allow active CASHIER and OWNER
--     accounts to record payments against APPROVED payroll entries while enforcing
--     remaining payable balance against effective payments.
--   • Updates payroll_periods RLS policy to allow active CASHIER and OWNER
--     accounts to create salary periods.
--   • Updates salary_payments RLS policy to allow active CASHIER and OWNER
--     accounts to insert payment disbursements.
--   • Restricts salary_payment_adjustments authorization strictly to active OWNER accounts.
--   • Grants npr_app_user USAGE and SELECT on both the business code sequence
--     (salary_adjustment_number_seq) and identity sequence (salary_payment_adjustments_id_seq).
--   • Maintains complete commercial invoice immutability (customer invoices unchanged).
-- =============================================================================

-- 1. Create Sequence for Salary Payment Adjustments
CREATE SEQUENCE salary_adjustment_number_seq START WITH 1 INCREMENT BY 1 NO CYCLE;

-- 2. Create Append-Only Salary Payment Adjustments Ledger
CREATE TABLE salary_payment_adjustments (
    id BIGSERIAL PRIMARY KEY,
    adjustment_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('NPR-SADJ-' || LPAD(nextval('public.salary_adjustment_number_seq'::regclass)::text, 6, '0')),
    salary_payment_id BIGINT NOT NULL REFERENCES public.salary_payments(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    payroll_entry_id BIGINT NOT NULL REFERENCES public.payroll_entries(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    worker_id BIGINT NOT NULL REFERENCES public.workers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    adjustment_type VARCHAR(20) NOT NULL CHECK (adjustment_type IN ('VOID', 'AMOUNT_CORRECTION')),
    prior_effective_amount NUMERIC(12, 2) NOT NULL CHECK (prior_effective_amount >= 0.00),
    corrected_amount NUMERIC(12, 2) NOT NULL CHECK (corrected_amount >= 0.00),
    adjustment_delta NUMERIC(12, 2) NOT NULL,
    authorized_by_owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) >= 16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_salary_adjustment_delta CHECK (
        adjustment_delta = (corrected_amount - prior_effective_amount)
    ),
    CONSTRAINT chk_salary_adjustment_amounts CHECK (
        (adjustment_type = 'VOID' AND corrected_amount = 0.00) OR
        (adjustment_type = 'AMOUNT_CORRECTION' AND corrected_amount > 0.00 AND corrected_amount != prior_effective_amount)
    )
);

-- 3. Create Supporting Indexes for Performance & Stable Ordering
CREATE INDEX idx_salary_payment_adjustments_payment ON salary_payment_adjustments(salary_payment_id, id DESC);
CREATE INDEX idx_salary_payment_adjustments_entry ON salary_payment_adjustments(payroll_entry_id, id DESC);
CREATE INDEX idx_salary_payment_adjustments_worker ON salary_payment_adjustments(worker_id, created_at DESC);
CREATE INDEX idx_salary_payment_adjustments_created_at ON salary_payment_adjustments(created_at DESC);

-- 4. Enforce Append-Only Immutability on salary_payment_adjustments
CREATE TRIGGER trg_salary_payment_adjustments_append_only
    BEFORE UPDATE OR DELETE ON salary_payment_adjustments
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

-- 5. Trigger Function to Validate and Bound Salary Payment Adjustments
-- Note: Concurrency hierarchy locks Parent (payroll_entries) FIRST, then Child (salary_payments) SECOND
-- to avoid deadlocks with concurrent payment disbursements and adjustments.
CREATE OR REPLACE FUNCTION public.enforce_salary_payment_adjustment_bounds()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_actor_role VARCHAR(20);
    v_actor_active BOOLEAN;
    v_payment_id BIGINT;
    v_payment_entry_id BIGINT;
    v_payment_worker_id BIGINT;
    v_original_amount NUMERIC(12, 2);
    v_entry_status VARCHAR(20);
    v_net_payable NUMERIC(12, 2);
    v_last_adj_type VARCHAR(20);
    v_last_corrected_amount NUMERIC(12, 2);
    v_current_effective NUMERIC(12, 2);
    v_entry_effective_paid NUMERIC(12, 2);
    v_new_effective_paid NUMERIC(12, 2);
BEGIN
    -- 1. Verify actor authorization: ONLY active OWNER accounts
    SELECT role, is_active INTO v_actor_role, v_actor_active
    FROM public.users
    WHERE id = NEW.authorized_by_owner_id;

    IF v_actor_role IS DISTINCT FROM 'OWNER' OR v_actor_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER accounts can authorize salary payment adjustments';
    END IF;

    -- 2. HIERARCHICAL LOCK STEP 1: Lock PARENT payroll_entry row first
    -- Serializes against other payments or adjustments on this payroll entry and prevents deadlocks
    SELECT status, net_payable
    INTO v_entry_status, v_net_payable
    FROM public.payroll_entries
    WHERE id = NEW.payroll_entry_id
    FOR UPDATE;

    IF v_entry_status IS NULL THEN
        RAISE EXCEPTION 'Payroll entry % does not exist', NEW.payroll_entry_id;
    END IF;

    IF v_entry_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Adjustments can only be recorded against APPROVED payroll entries (status: %)',
            v_entry_status;
    END IF;

    -- 3. HIERARCHICAL LOCK STEP 2: Lock CHILD salary_payment row second
    -- Serializes concurrent adjustments on this specific payment
    SELECT id, payroll_entry_id, worker_id, amount
    INTO v_payment_id, v_payment_entry_id, v_payment_worker_id, v_original_amount
    FROM public.salary_payments
    WHERE id = NEW.salary_payment_id
    FOR UPDATE;

    IF v_payment_id IS NULL THEN
        RAISE EXCEPTION 'Salary payment % does not exist', NEW.salary_payment_id;
    END IF;

    -- 4. Validate referential alignment across locked parent and child
    IF NEW.payroll_entry_id IS DISTINCT FROM v_payment_entry_id THEN
        RAISE EXCEPTION 'Adjustment payroll_entry_id (%) does not match salary payment payroll_entry_id (%)',
            NEW.payroll_entry_id, v_payment_entry_id;
    END IF;

    IF NEW.worker_id IS DISTINCT FROM v_payment_worker_id THEN
        RAISE EXCEPTION 'Adjustment worker_id (%) does not match salary payment worker_id (%)',
            NEW.worker_id, v_payment_worker_id;
    END IF;

    -- 5. Retrieve latest prior adjustment for this payment (stable ordering by id DESC)
    SELECT adjustment_type, corrected_amount
    INTO v_last_adj_type, v_last_corrected_amount
    FROM public.salary_payment_adjustments
    WHERE salary_payment_id = NEW.salary_payment_id
    ORDER BY id DESC
    LIMIT 1;

    -- 6. Reject any adjustment if payment has already been voided
    IF v_last_adj_type = 'VOID' THEN
        RAISE EXCEPTION 'Cannot adjust salary payment % because it has already been voided',
            NEW.salary_payment_id;
    END IF;

    -- 7. Determine current effective amount before this new adjustment
    IF v_last_adj_type IS NOT NULL THEN
        v_current_effective := v_last_corrected_amount;
    ELSE
        v_current_effective := v_original_amount;
    END IF;

    -- 8. Verify that prior_effective_amount matches the actual current effective amount
    IF NEW.prior_effective_amount IS DISTINCT FROM v_current_effective THEN
        RAISE EXCEPTION 'Stale prior effective amount for payment %: expected %, got %',
            NEW.salary_payment_id, v_current_effective, NEW.prior_effective_amount;
    END IF;

    -- 9. Calculate total effective amount already paid for this payroll entry
    SELECT COALESCE(SUM(
        COALESCE(
            (
                SELECT spa.corrected_amount
                FROM public.salary_payment_adjustments spa
                WHERE spa.salary_payment_id = sp.id
                ORDER BY spa.id DESC
                LIMIT 1
            ),
            sp.amount
        )
    ), 0.00)::NUMERIC(12, 2)
    INTO v_entry_effective_paid
    FROM public.salary_payments sp
    WHERE sp.payroll_entry_id = NEW.payroll_entry_id;

    -- 10. Calculate projected total effective paid after applying this adjustment
    v_new_effective_paid := v_entry_effective_paid + (NEW.corrected_amount - v_current_effective);

    IF v_new_effective_paid > v_net_payable THEN
        RAISE EXCEPTION 'Salary payment adjustment causes total paid (%) to exceed net payable (%) for payroll entry %',
            v_new_effective_paid, v_net_payable, NEW.payroll_entry_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_salary_payment_adjustments_before_insert
    BEFORE INSERT ON salary_payment_adjustments
    FOR EACH ROW EXECUTE FUNCTION enforce_salary_payment_adjustment_bounds();

-- 6. Update enforce_salary_payment_bounds() for Cashier Disbursements and Effective Balance
CREATE OR REPLACE FUNCTION enforce_salary_payment_bounds()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_role VARCHAR(20);
    v_active BOOLEAN;
    v_entry_status VARCHAR(20);
    v_entry_worker_id BIGINT;
    v_net_payable NUMERIC(12, 2);
    v_already_paid NUMERIC(12, 2);
BEGIN
    -- Permit active OWNER and CASHIER accounts to record payments
    SELECT role, is_active INTO v_role, v_active FROM public.users WHERE id = NEW.paid_by_owner_id;
    IF v_role NOT IN ('OWNER', 'CASHIER') OR v_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER or CASHIER accounts can disburse salary payments';
    END IF;

    -- HIERARCHICAL LOCK: Lock PARENT payroll_entry row
    SELECT status, worker_id, net_payable
    INTO v_entry_status, v_entry_worker_id, v_net_payable
    FROM public.payroll_entries
    WHERE id = NEW.payroll_entry_id
    FOR UPDATE;

    IF v_entry_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Salary payments can only be recorded against APPROVED payroll entries (status: %)',
            COALESCE(v_entry_status, 'NOT_FOUND');
    END IF;

    IF v_entry_worker_id IS DISTINCT FROM NEW.worker_id THEN
        RAISE EXCEPTION 'Salary payment worker_id does not match payroll entry worker';
    END IF;

    -- Calculate total effective paid amount incorporating latest adjustments
    SELECT COALESCE(SUM(
        COALESCE(
            (
                SELECT spa.corrected_amount
                FROM public.salary_payment_adjustments spa
                WHERE spa.salary_payment_id = sp.id
                ORDER BY spa.id DESC
                LIMIT 1
            ),
            sp.amount
        )
    ), 0.00)::NUMERIC(12, 2)
    INTO v_already_paid
    FROM public.salary_payments sp
    WHERE sp.payroll_entry_id = NEW.payroll_entry_id;

    IF v_already_paid + NEW.amount > v_net_payable THEN
        RAISE EXCEPTION 'Salary payment (%) exceeds remaining payable balance (%) for payroll entry %',
            NEW.amount, (v_net_payable - v_already_paid), NEW.payroll_entry_id;
    END IF;

    RETURN NEW;
END;
$$;

-- 7. Enforce Creator Immutability & Owner Approval on payroll_periods
CREATE OR REPLACE FUNCTION enforce_payroll_period_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_approver_role VARCHAR(20);
    v_approver_active BOOLEAN;
BEGIN
    -- 1. True original creator identity is permanently immutable
    IF NEW.created_by_owner_id IS DISTINCT FROM OLD.created_by_owner_id THEN
        RAISE EXCEPTION 'created_by_owner_id is immutable and cannot be modified';
    END IF;

    -- 2. If status transitions to APPROVED or CLOSED, approved_by_owner_id is mandatory and must be an active OWNER
    IF NEW.status IN ('APPROVED', 'CLOSED') THEN
        IF NEW.approved_by_owner_id IS NULL THEN
            RAISE EXCEPTION 'approved_by_owner_id is required when payroll period status is %', NEW.status;
        END IF;

        SELECT role, is_active INTO v_approver_role, v_approver_active
        FROM public.users WHERE id = NEW.approved_by_owner_id;

        IF v_approver_role IS DISTINCT FROM 'OWNER' OR v_approver_active IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Only active OWNER accounts can approve payroll periods';
        END IF;
    END IF;

    -- 3. If approved or closed, period date boundaries are permanently immutable
    IF OLD.status IN ('APPROVED', 'CLOSED') THEN
        IF NEW.start_date != OLD.start_date OR NEW.end_date != OLD.end_date THEN
            RAISE EXCEPTION 'Date boundaries of an approved or closed payroll period are immutable';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payroll_periods_before_update
    BEFORE UPDATE ON payroll_periods
    FOR EACH ROW EXECUTE FUNCTION enforce_payroll_period_immutability();

-- 8. Update Row-Level Security (RLS) Policies on Existing Tables
DROP POLICY IF EXISTS app_payroll_periods_all ON public.payroll_periods;
DROP POLICY IF EXISTS app_payroll_periods_select ON public.payroll_periods;
DROP POLICY IF EXISTS app_payroll_periods_insert ON public.payroll_periods;
DROP POLICY IF EXISTS app_payroll_periods_update ON public.payroll_periods;

CREATE POLICY app_payroll_periods_select ON public.payroll_periods
    FOR SELECT TO npr_app_user
    USING (true);

CREATE POLICY app_payroll_periods_insert ON public.payroll_periods
    FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = created_by_owner_id
              AND u.role IN ('OWNER', 'CASHIER')
              AND u.is_active = true
        )
    );

CREATE POLICY app_payroll_periods_update ON public.payroll_periods
    FOR UPDATE TO npr_app_user
    USING (true)
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = created_by_owner_id
              AND u.role IN ('OWNER', 'CASHIER')
              AND u.is_active = true
        )
        AND (
            approved_by_owner_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.users u
                WHERE u.id = approved_by_owner_id
                  AND u.role = 'OWNER'
                  AND u.is_active = true
            )
        )
    );

DROP POLICY IF EXISTS app_salary_payments_insert ON public.salary_payments;
CREATE POLICY app_salary_payments_insert ON public.salary_payments FOR INSERT TO npr_app_user
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = paid_by_owner_id
              AND u.role IN ('OWNER', 'CASHIER')
              AND u.is_active = true
        )
    );

-- 9. Enable RLS and Lock Down Permissions on salary_payment_adjustments
ALTER TABLE public.salary_payment_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.salary_payment_adjustments FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.salary_adjustment_number_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.salary_payment_adjustments_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_payroll_period_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_salary_payment_adjustment_bounds() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_salary_payment_bounds() FROM PUBLIC;

DO $$
DECLARE
    v_role TEXT;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.salary_payment_adjustments FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON SEQUENCE public.salary_adjustment_number_seq FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON SEQUENCE public.salary_payment_adjustments_id_seq FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON FUNCTION public.enforce_payroll_period_immutability() FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON FUNCTION public.enforce_salary_payment_adjustment_bounds() FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON FUNCTION public.enforce_salary_payment_bounds() FROM %I', v_role);
        END IF;
    END LOOP;
END
$$;

-- 10. Minimal Grants and RLS Policies for npr_app_user
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npr_app_user') THEN
        REVOKE ALL ON FUNCTION public.enforce_payroll_period_immutability() FROM npr_app_user;
        REVOKE ALL ON FUNCTION public.enforce_salary_payment_adjustment_bounds() FROM npr_app_user;
        REVOKE ALL ON FUNCTION public.enforce_salary_payment_bounds() FROM npr_app_user;

        GRANT USAGE, SELECT ON SEQUENCE public.salary_adjustment_number_seq TO npr_app_user;
        GRANT USAGE, SELECT ON SEQUENCE public.salary_payment_adjustments_id_seq TO npr_app_user;
        GRANT SELECT, INSERT ON public.salary_payment_adjustments TO npr_app_user;

        DROP POLICY IF EXISTS app_salary_payment_adjustments_select ON public.salary_payment_adjustments;
        CREATE POLICY app_salary_payment_adjustments_select ON public.salary_payment_adjustments
            FOR SELECT TO npr_app_user
            USING (true);

        DROP POLICY IF EXISTS app_salary_payment_adjustments_insert ON public.salary_payment_adjustments;
        CREATE POLICY app_salary_payment_adjustments_insert ON public.salary_payment_adjustments
            FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.users u
                    WHERE u.id = authorized_by_owner_id
                      AND u.role = 'OWNER'
                      AND u.is_active = true
                )
            );
    END IF;
END
$$;
