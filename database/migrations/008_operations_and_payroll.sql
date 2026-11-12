-- Up Migration
-- =============================================================================
-- Migration 008: Material Version Guard, Operations, Approvals & Owner Payroll
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • Forward-only transactional schema migration.
--   • Preserves existing migrations 001-007 untouched.
--   • Enforces optimistic concurrency on materials price updates.
--   • Enforces DRAFT -> SUBMITTED -> APPROVED / RETURNED_FOR_CORRECTION lifecycle
--     at both PostgreSQL trigger level and service transaction level.
--   • Keeps compensation, payroll entries, advances, salary payments, and expenses
--     strictly append-only where financial and protected from Cashier mutation.
-- =============================================================================

-- 1. Optimistic concurrency version column on materials + idempotency types
ALTER TABLE materials
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1 CHECK (version >= 1);

ALTER TABLE idempotency_records
    DROP CONSTRAINT IF EXISTS idempotency_records_operation_type_check;

ALTER TABLE idempotency_records
    ADD CONSTRAINT idempotency_records_operation_type_check CHECK (
        operation_type IN (
            'ISSUE_INVOICE',
            'RECORD_PAYMENT',
            'PAYMENT_ADJUSTMENT',
            'ISSUE_CREDIT_NOTE',
            'UPDATE_MATERIAL_PRICE',
            'RECORD_WORKER_ADVANCE',
            'RECORD_SALARY_PAYMENT',
            'RECORD_EXPENSE'
        )
    );

-- 2. Sequences for human-readable operational & payroll document numbers
CREATE SEQUENCE advance_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE salary_receipt_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE expense_number_seq START WITH 1 INCREMENT BY 1;

-- 3. Workers & Owner-Only Compensation Profiles
CREATE TABLE workers (
    id BIGSERIAL PRIMARY KEY,
    worker_code VARCHAR(20) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL CHECK (length(trim(full_name)) >= 2),
    phone VARCHAR(20),
    designation VARCHAR(60) NOT NULL CHECK (length(trim(designation)) >= 2),
    joined_date DATE,
    employment_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (employment_status IN ('ACTIVE', 'INACTIVE', 'ON_LEAVE')),
    notes TEXT,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workers_status_name ON workers(employment_status, LOWER(full_name));

CREATE TABLE worker_compensation_profiles (
    id BIGSERIAL PRIMARY KEY,
    worker_id BIGINT NOT NULL UNIQUE REFERENCES workers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    pay_arrangement VARCHAR(20) NOT NULL CHECK (pay_arrangement IN ('HOURLY', 'DAILY', 'MONTHLY', 'MANUAL')),
    base_rate NUMERIC(12, 2) CHECK (base_rate IS NULL OR base_rate >= 0.00),
    overtime_hourly_rate NUMERIC(12, 2) CHECK (overtime_hourly_rate IS NULL OR overtime_hourly_rate >= 0.00),
    effective_from DATE NOT NULL,
    notes TEXT,
    updated_by_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Worker Attendance (DRAFT -> SUBMITTED -> APPROVED / RETURNED_FOR_CORRECTION)
CREATE TABLE worker_attendance (
    id BIGSERIAL PRIMARY KEY,
    work_date DATE NOT NULL,
    worker_id BIGINT NOT NULL REFERENCES workers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    crosses_midnight BOOLEAN NOT NULL DEFAULT false,
    break_minutes INT NOT NULL DEFAULT 0 CHECK (break_minutes >= 0 AND break_minutes <= 720),
    hours_worked NUMERIC(6, 2) NOT NULL CHECK (hours_worked >= 0.00 AND hours_worked <= 24.00),
    overtime_hours NUMERIC(6, 2) NOT NULL DEFAULT 0.00 CHECK (overtime_hours >= 0.00 AND overtime_hours <= 24.00),
    remarks TEXT,
    entered_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
        CHECK (approval_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED_FOR_CORRECTION', 'CANCELLED')),
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    submitted_at TIMESTAMPTZ,
    reviewed_by_owner_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_worker_attendance_time CHECK (crosses_midnight = true OR end_time > start_time)
);

CREATE INDEX idx_worker_attendance_date_status ON worker_attendance(work_date DESC, approval_status);
CREATE INDEX idx_worker_attendance_worker_date ON worker_attendance(worker_id, work_date DESC);

-- 5. Machines & Working-Hour Logs
CREATE TABLE machines (
    id SERIAL PRIMARY KEY,
    machine_code VARCHAR(20) NOT NULL UNIQUE,
    machine_name VARCHAR(100) NOT NULL CHECK (length(trim(machine_name)) >= 2),
    machine_type VARCHAR(60) NOT NULL CHECK (length(trim(machine_type)) >= 2),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_machines_active_name ON machines(is_active, LOWER(machine_name));

CREATE TABLE machine_work_logs (
    id BIGSERIAL PRIMARY KEY,
    work_date DATE NOT NULL,
    machine_id INT NOT NULL REFERENCES machines(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    operator_worker_id BIGINT REFERENCES workers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    crosses_midnight BOOLEAN NOT NULL DEFAULT false,
    downtime_minutes INT NOT NULL DEFAULT 0 CHECK (downtime_minutes >= 0 AND downtime_minutes <= 1440),
    downtime_reason TEXT,
    net_operating_hours NUMERIC(6, 2) NOT NULL CHECK (net_operating_hours >= 0.00 AND net_operating_hours <= 24.00),
    scheduled_hours NUMERIC(6, 2) CHECK (scheduled_hours IS NULL OR (scheduled_hours > 0.00 AND scheduled_hours <= 24.00)),
    remarks TEXT,
    entered_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
        CHECK (approval_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED_FOR_CORRECTION', 'CANCELLED')),
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    submitted_at TIMESTAMPTZ,
    reviewed_by_owner_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_machine_work_logs_time CHECK (crosses_midnight = true OR end_time > start_time)
);

CREATE INDEX idx_machine_logs_date_status ON machine_work_logs(work_date DESC, approval_status);
CREATE INDEX idx_machine_logs_machine_date ON machine_work_logs(machine_id, work_date DESC);

-- 6. Daily Crushed-Metal Production Logs (m³)
CREATE TABLE production_logs (
    id BIGSERIAL PRIMARY KEY,
    production_date DATE NOT NULL,
    material_id INT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    machine_id INT REFERENCES machines(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    operator_worker_id BIGINT REFERENCES workers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    shift_label VARCHAR(40),
    quantity_produced NUMERIC(12, 3) NOT NULL CHECK (quantity_produced > 0.000),
    unit VARCHAR(10) NOT NULL DEFAULT 'm³' CHECK (unit = 'm³'),
    remarks TEXT,
    entered_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
        CHECK (approval_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED_FOR_CORRECTION', 'CANCELLED')),
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    submitted_at TIMESTAMPTZ,
    reviewed_by_owner_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_production_logs_date_status ON production_logs(production_date DESC, approval_status);
CREATE INDEX idx_production_logs_material_date ON production_logs(material_id, production_date DESC);

-- 7. Operational Approval & Revision Trail (Append-Only)
CREATE TABLE operational_approval_history (
    id BIGSERIAL PRIMARY KEY,
    record_type VARCHAR(30) NOT NULL CHECK (record_type IN ('ATTENDANCE', 'MACHINE_LOG', 'PRODUCTION_LOG')),
    record_id BIGINT NOT NULL,
    action VARCHAR(40) NOT NULL CHECK (
        action IN ('CREATED', 'UPDATED_DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED_FOR_CORRECTION', 'CANCELLED')
    ),
    from_status VARCHAR(30),
    to_status VARCHAR(30) NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reason TEXT,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_op_history_record ON operational_approval_history(record_type, record_id, created_at DESC);

-- 8. Owner-Only Payroll, Advances, Salary Payments & Expenses
CREATE TABLE payroll_periods (
    id BIGSERIAL PRIMARY KEY,
    period_label VARCHAR(80) NOT NULL CHECK (length(trim(period_label)) >= 3),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'CLOSED')),
    notes TEXT,
    created_by_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    approved_by_owner_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    approved_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_payroll_period_dates CHECK (end_date >= start_date)
);

CREATE TABLE payroll_entries (
    id BIGSERIAL PRIMARY KEY,
    payroll_period_id BIGINT NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    worker_id BIGINT NOT NULL REFERENCES workers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    pay_arrangement_snapshot VARCHAR(20) NOT NULL CHECK (pay_arrangement_snapshot IN ('HOURLY', 'DAILY', 'MONTHLY', 'MANUAL')),
    calculation_mode VARCHAR(30) NOT NULL CHECK (calculation_mode IN ('CONFIGURED_AUTO', 'OWNER_MANUAL_DRAFT')),
    approved_days_count INT NOT NULL DEFAULT 0 CHECK (approved_days_count >= 0),
    approved_regular_hours NUMERIC(8, 2) NOT NULL DEFAULT 0.00 CHECK (approved_regular_hours >= 0.00),
    approved_overtime_hours NUMERIC(8, 2) NOT NULL DEFAULT 0.00 CHECK (approved_overtime_hours >= 0.00),
    base_pay NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (base_pay >= 0.00),
    overtime_pay NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (overtime_pay >= 0.00),
    allowances NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (allowances >= 0.00),
    deductions NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (deductions >= 0.00),
    advance_deduction NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (advance_deduction >= 0.00),
    gross_pay NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (gross_pay = ROUND(base_pay + overtime_pay + allowances, 2)),
    net_payable NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (net_payable >= 0.00),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'CANCELLED')),
    notes TEXT,
    approved_by_owner_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    approved_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payroll_entry_period_worker UNIQUE (payroll_period_id, worker_id),
    CONSTRAINT chk_payroll_net_payable CHECK (
        net_payable = GREATEST(ROUND((base_pay + overtime_pay + allowances) - deductions - advance_deduction, 2), 0.00)
    )
);

CREATE INDEX idx_payroll_entries_period ON payroll_entries(payroll_period_id, status);

CREATE TABLE worker_advances (
    id BIGSERIAL PRIMARY KEY,
    advance_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('NPR-ADV-' || LPAD(nextval('advance_number_seq')::text, 6, '0')),
    worker_id BIGINT NOT NULL REFERENCES workers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    advance_date DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0.00),
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
    authorized_by_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) >= 16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_worker_advances_worker_date ON worker_advances(worker_id, advance_date DESC);

CREATE TABLE salary_payments (
    id BIGSERIAL PRIMARY KEY,
    salary_receipt_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('NPR-SAL-' || LPAD(nextval('salary_receipt_number_seq')::text, 6, '0')),
    payroll_entry_id BIGINT NOT NULL REFERENCES payroll_entries(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    worker_id BIGINT NOT NULL REFERENCES workers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    payment_date DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0.00),
    payment_method VARCHAR(20) NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'BANK_TRANSFER')),
    reference_note TEXT,
    paid_by_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) >= 16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_salary_payments_entry ON salary_payments(payroll_entry_id, payment_date DESC);
CREATE INDEX idx_salary_payments_date ON salary_payments(payment_date DESC);

CREATE TABLE operational_expenses (
    id BIGSERIAL PRIMARY KEY,
    expense_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('NPR-EXP-' || LPAD(nextval('expense_number_seq')::text, 6, '0')),
    expense_date DATE NOT NULL,
    category VARCHAR(60) NOT NULL CHECK (length(trim(category)) >= 2),
    description TEXT NOT NULL CHECK (length(trim(description)) >= 3),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0.00),
    recorded_by_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) >= 16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_operational_expenses_date ON operational_expenses(expense_date DESC);

-- 9. Updated-At & Integrity Triggers
CREATE TRIGGER trg_workers_set_updated_at
    BEFORE UPDATE ON workers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_worker_comp_set_updated_at
    BEFORE UPDATE ON worker_compensation_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_worker_attendance_set_updated_at
    BEFORE UPDATE ON worker_attendance FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_machines_set_updated_at
    BEFORE UPDATE ON machines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_machine_work_logs_set_updated_at
    BEFORE UPDATE ON machine_work_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_production_logs_set_updated_at
    BEFORE UPDATE ON production_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payroll_periods_set_updated_at
    BEFORE UPDATE ON payroll_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payroll_entries_set_updated_at
    BEFORE UPDATE ON payroll_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only ledger locks
CREATE TRIGGER trg_op_history_append_only
    BEFORE UPDATE OR DELETE ON operational_approval_history
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER trg_worker_advances_append_only
    BEFORE UPDATE OR DELETE ON worker_advances
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER trg_salary_payments_append_only
    BEFORE UPDATE OR DELETE ON salary_payments
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER trg_operational_expenses_append_only
    BEFORE UPDATE OR DELETE ON operational_expenses
    FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

-- Enforce operational approval workflow transitions
CREATE OR REPLACE FUNCTION enforce_operational_approval_transition()
RETURNS TRIGGER AS $$
DECLARE
    v_reviewer_role VARCHAR(20);
    v_reviewer_active BOOLEAN;
BEGIN
    IF OLD.approval_status IN ('APPROVED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Operational record % with status % is immutable', OLD.id, OLD.approval_status;
    END IF;

    IF OLD.approval_status IN ('DRAFT', 'RETURNED_FOR_CORRECTION') THEN
        IF NEW.approval_status = 'APPROVED' THEN
            RAISE EXCEPTION 'Operational record must be SUBMITTED before Owner approval';
        END IF;
        NEW.version := OLD.version + 1;
        RETURN NEW;
    END IF;

    IF OLD.approval_status = 'SUBMITTED' THEN
        IF NEW.approval_status NOT IN ('APPROVED', 'RETURNED_FOR_CORRECTION') THEN
            RAISE EXCEPTION 'SUBMITTED operational record can only transition to APPROVED or RETURNED_FOR_CORRECTION';
        END IF;

        IF NEW.reviewed_by_owner_id IS NULL THEN
            RAISE EXCEPTION 'reviewed_by_owner_id is required when reviewing submitted record';
        END IF;

        SELECT role, is_active INTO v_reviewer_role, v_reviewer_active
        FROM public.users WHERE id = NEW.reviewed_by_owner_id;

        IF v_reviewer_role IS DISTINCT FROM 'OWNER' OR v_reviewer_active IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Only active OWNER accounts can approve or return operational records';
        END IF;

        IF NEW.approval_status = 'RETURNED_FOR_CORRECTION'
           AND (NEW.review_reason IS NULL OR length(trim(NEW.review_reason)) < 5) THEN
            RAISE EXCEPTION 'A correction reason (min 5 characters) is required when returning a submission';
        END IF;

        NEW.reviewed_at := COALESCE(NEW.reviewed_at, NOW());
        NEW.version := OLD.version + 1;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_worker_attendance_lifecycle
    BEFORE UPDATE ON worker_attendance
    FOR EACH ROW EXECUTE FUNCTION enforce_operational_approval_transition();

CREATE TRIGGER trg_machine_work_logs_lifecycle
    BEFORE UPDATE ON machine_work_logs
    FOR EACH ROW EXECUTE FUNCTION enforce_operational_approval_transition();

CREATE TRIGGER trg_production_logs_lifecycle
    BEFORE UPDATE ON production_logs
    FOR EACH ROW EXECUTE FUNCTION enforce_operational_approval_transition();

-- Enforce active OWNER for compensation, advances & expenses
CREATE OR REPLACE FUNCTION enforce_owner_actor_for_finance()
RETURNS TRIGGER AS $$
DECLARE
    v_owner_id UUID;
    v_role VARCHAR(20);
    v_active BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'worker_compensation_profiles' THEN
        v_owner_id := NEW.updated_by_owner_id;
    ELSIF TG_TABLE_NAME = 'worker_advances' THEN
        v_owner_id := NEW.authorized_by_owner_id;
    ELSIF TG_TABLE_NAME = 'operational_expenses' THEN
        v_owner_id := NEW.recorded_by_owner_id;
    END IF;

    SELECT role, is_active INTO v_role, v_active FROM public.users WHERE id = v_owner_id;
    IF v_role IS DISTINCT FROM 'OWNER' OR v_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER accounts can perform operation on %', TG_TABLE_NAME;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_worker_comp_owner
    BEFORE INSERT OR UPDATE ON worker_compensation_profiles
    FOR EACH ROW EXECUTE FUNCTION enforce_owner_actor_for_finance();

CREATE TRIGGER trg_worker_advances_owner
    BEFORE INSERT ON worker_advances
    FOR EACH ROW EXECUTE FUNCTION enforce_owner_actor_for_finance();

CREATE TRIGGER trg_operational_expenses_owner
    BEFORE INSERT ON operational_expenses
    FOR EACH ROW EXECUTE FUNCTION enforce_owner_actor_for_finance();

-- Enforce salary payment bounds & duplicate/overpayment serialization
CREATE OR REPLACE FUNCTION enforce_salary_payment_bounds()
RETURNS TRIGGER AS $$
DECLARE
    v_role VARCHAR(20);
    v_active BOOLEAN;
    v_entry_status VARCHAR(20);
    v_entry_worker_id BIGINT;
    v_net_payable NUMERIC(12, 2);
    v_already_paid NUMERIC(12, 2);
BEGIN
    SELECT role, is_active INTO v_role, v_active FROM public.users WHERE id = NEW.paid_by_owner_id;
    IF v_role IS DISTINCT FROM 'OWNER' OR v_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only active OWNER accounts can disburse salary payments';
    END IF;

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

    SELECT COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2)
    INTO v_already_paid
    FROM public.salary_payments
    WHERE payroll_entry_id = NEW.payroll_entry_id;

    IF v_already_paid + NEW.amount > v_net_payable THEN
        RAISE EXCEPTION 'Salary payment (%) exceeds remaining payable balance (%) for payroll entry %',
            NEW.amount, (v_net_payable - v_already_paid), NEW.payroll_entry_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_salary_payments_before_insert
    BEFORE INSERT ON salary_payments
    FOR EACH ROW EXECUTE FUNCTION enforce_salary_payment_bounds();

-- 10. Enable RLS & Lock Down PUBLIC / anon / authenticated Access
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_compensation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_work_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_approval_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_expenses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    workers,
    worker_compensation_profiles,
    worker_attendance,
    machines,
    machine_work_logs,
    production_logs,
    operational_approval_history,
    payroll_periods,
    payroll_entries,
    worker_advances,
    salary_payments,
    operational_expenses
FROM PUBLIC;

REVOKE ALL ON SEQUENCE
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
FROM PUBLIC;

REVOKE ALL ON FUNCTION
    enforce_operational_approval_transition(),
    enforce_owner_actor_for_finance(),
    enforce_salary_payment_bounds()
FROM PUBLIC;

DO $$
DECLARE
    v_role TEXT;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
            EXECUTE format(
                'REVOKE ALL ON TABLE workers, worker_compensation_profiles, worker_attendance, machines, machine_work_logs, production_logs, operational_approval_history, payroll_periods, payroll_entries, worker_advances, salary_payments, operational_expenses FROM %I',
                v_role
            );
            EXECUTE format(
                'REVOKE ALL ON SEQUENCE advance_number_seq, salary_receipt_number_seq, expense_number_seq, workers_id_seq, worker_compensation_profiles_id_seq, worker_attendance_id_seq, machines_id_seq, machine_work_logs_id_seq, production_logs_id_seq, operational_approval_history_id_seq, payroll_periods_id_seq, payroll_entries_id_seq, worker_advances_id_seq, salary_payments_id_seq, operational_expenses_id_seq FROM %I',
                v_role
            );
            EXECUTE format(
                'REVOKE ALL ON FUNCTION enforce_operational_approval_transition(), enforce_owner_actor_for_finance(), enforce_salary_payment_bounds() FROM %I',
                v_role
            );
        END IF;
    END LOOP;
END
$$;

-- 11. Conditional Minimal Grants & RLS Policies for npr_app_user (Zero DELETE privileges)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npr_app_user') THEN
        REVOKE ALL ON FUNCTION
            enforce_operational_approval_transition(),
            enforce_owner_actor_for_finance(),
            enforce_salary_payment_bounds()
        FROM npr_app_user;

        GRANT UPDATE (version) ON materials TO npr_app_user;

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

        GRANT SELECT, INSERT, UPDATE ON workers TO npr_app_user;
        GRANT SELECT, INSERT, UPDATE ON worker_compensation_profiles TO npr_app_user;
        GRANT SELECT, INSERT, UPDATE ON worker_attendance TO npr_app_user;
        GRANT SELECT, INSERT, UPDATE ON machines TO npr_app_user;
        GRANT SELECT, INSERT, UPDATE ON machine_work_logs TO npr_app_user;
        GRANT SELECT, INSERT, UPDATE ON production_logs TO npr_app_user;
        GRANT SELECT, INSERT ON operational_approval_history TO npr_app_user;
        GRANT SELECT, INSERT, UPDATE ON payroll_periods TO npr_app_user;
        GRANT SELECT, INSERT, UPDATE ON payroll_entries TO npr_app_user;
        GRANT SELECT, INSERT ON worker_advances TO npr_app_user;
        GRANT SELECT, INSERT ON salary_payments TO npr_app_user;
        GRANT SELECT, INSERT ON operational_expenses TO npr_app_user;

        DROP POLICY IF EXISTS app_workers_all ON workers;
        CREATE POLICY app_workers_all ON workers FOR ALL TO npr_app_user USING (true) WITH CHECK (true);

        DROP POLICY IF EXISTS app_worker_comp_all ON worker_compensation_profiles;
        CREATE POLICY app_worker_comp_all ON worker_compensation_profiles FOR ALL TO npr_app_user
            USING (true)
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = updated_by_owner_id AND u.role = 'OWNER' AND u.is_active = true
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
        CREATE POLICY app_payroll_periods_all ON payroll_periods FOR ALL TO npr_app_user
            USING (true)
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = created_by_owner_id AND u.role = 'OWNER' AND u.is_active = true
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
                    WHERE u.id = authorized_by_owner_id AND u.role = 'OWNER' AND u.is_active = true
                )
            );

        DROP POLICY IF EXISTS app_salary_payments_select ON salary_payments;
        DROP POLICY IF EXISTS app_salary_payments_insert ON salary_payments;
        CREATE POLICY app_salary_payments_select ON salary_payments FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_salary_payments_insert ON salary_payments FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = paid_by_owner_id AND u.role = 'OWNER' AND u.is_active = true
                )
            );

        DROP POLICY IF EXISTS app_expenses_select ON operational_expenses;
        DROP POLICY IF EXISTS app_expenses_insert ON operational_expenses;
        CREATE POLICY app_expenses_select ON operational_expenses FOR SELECT TO npr_app_user USING (true);
        CREATE POLICY app_expenses_insert ON operational_expenses FOR INSERT TO npr_app_user
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.id = recorded_by_owner_id AND u.role = 'OWNER' AND u.is_active = true
                )
            );
    END IF;
END
$$;

