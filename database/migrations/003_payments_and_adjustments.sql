-- Up Migration
-- =============================================================================
-- Migration 003: Append-Only Cash Payments, Corrections, Credit Notes & Idempotency
-- Project: NPR Metal Crusher — Billing & Management System
-- =============================================================================

CREATE SEQUENCE receipt_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE adjustment_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE credit_note_number_seq START WITH 1 INCREMENT BY 1;

-- 1. Append-Only Cash Payments Ledger
CREATE TABLE payments (
    id BIGSERIAL PRIMARY KEY,
    receipt_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('NPR-REC-' || LPAD(nextval('receipt_number_seq')::text, 6, '0')),
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    cashier_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0.00),
    payment_method VARCHAR(20) NOT NULL DEFAULT 'CASH' CHECK (payment_method = 'CASH'),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_payments_idempotency_len CHECK (length(trim(idempotency_key)) >= 16)
);

CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_cashier_created ON payments(cashier_user_id, created_at DESC);
CREATE INDEX idx_payments_created_at ON payments(created_at DESC);

-- 2. Auditable Payment Adjustments Ledger (Entry Reversals vs Physical Cash Refunds)
--   • ENTRY_REVERSAL: Clerical entry correction; no physical cash leaves drawer.
--                     Attributed in reconciliation to original receipt cashier's ledger.
--   • CASH_REFUND:    Physical cash handed back to customer on adjustment date.
--                     Attributed strictly to performed_by_user_id (drawer payout actor).
--   • authorized_by_owner_id: Owner approving the adjustment (must hold role = 'OWNER').
--   • performed_by_user_id:   Staff member physically handling the refund payout or reversal.
CREATE TABLE payment_adjustments (
    id BIGSERIAL PRIMARY KEY,
    adjustment_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('NPR-ADJ-' || LPAD(nextval('adjustment_number_seq')::text, 6, '0')),
    payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    authorized_by_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    performed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    adjustment_type VARCHAR(20) NOT NULL CHECK (adjustment_type IN ('ENTRY_REVERSAL', 'CASH_REFUND')),
    adjustment_amount NUMERIC(12, 2) NOT NULL CHECK (adjustment_amount > 0.00),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_payment_adjustments_idempotency_len CHECK (length(trim(idempotency_key)) >= 16)
);

CREATE INDEX idx_payment_adjustments_payment_id ON payment_adjustments(payment_id);
CREATE INDEX idx_payment_adjustments_created_at ON payment_adjustments(created_at DESC);
CREATE INDEX idx_payment_adjustments_refund_performer
    ON payment_adjustments(performed_by_user_id, created_at DESC)
    WHERE adjustment_type = 'CASH_REFUND';

-- 3. Formal Credit Notes & Invoice Cancellation Ledger
-- Reduces commercial liability without deleting historical invoices and WITHOUT
-- implying cash was physically refunded (excess_cash_resolution enforces explicit audit).
CREATE TABLE credit_notes (
    id BIGSERIAL PRIMARY KEY,
    credit_note_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('NPR-CRN-' || LPAD(nextval('credit_note_number_seq')::text, 6, '0')),
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    authorized_by_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    credit_amount NUMERIC(12, 2) NOT NULL CHECK (credit_amount > 0.00),
    excess_cash_resolution VARCHAR(30) NOT NULL DEFAULT 'NONE' CHECK (
        excess_cash_resolution IN (
            'NONE',
            'REFUNDED_IN_TX',
            'ENTRY_REVERSED_IN_TX',
            'PENDING_CUSTOMER_REFUND'
        )
    ),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_credit_notes_idempotency_len CHECK (length(trim(idempotency_key)) >= 16)
);

CREATE INDEX idx_credit_notes_invoice_id ON credit_notes(invoice_id);
CREATE INDEX idx_credit_notes_created_at ON credit_notes(created_at DESC);

-- 4. Request-Bound Financial Idempotency Records
-- Commits atomically alongside the target financial mutation.
CREATE TABLE idempotency_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    operation_type VARCHAR(40) NOT NULL CHECK (
        operation_type IN (
            'ISSUE_INVOICE',
            'RECORD_PAYMENT',
            'PAYMENT_ADJUSTMENT',
            'ISSUE_CREDIT_NOTE'
        )
    ),
    request_hash VARCHAR(64) NOT NULL CHECK (length(request_hash) = 64),
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    response_status INT NOT NULL CHECK (response_status BETWEEN 100 AND 599),
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    CONSTRAINT chk_idempotency_key_len CHECK (length(trim(idempotency_key)) >= 16)
);

CREATE INDEX idx_idempotency_records_expires_at ON idempotency_records(expires_at);
