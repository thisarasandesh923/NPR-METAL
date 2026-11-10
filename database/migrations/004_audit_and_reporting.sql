-- Up Migration
-- =============================================================================
-- Migration 004: Audit Logs & Authoritative Financial Reporting Views
-- Project: NPR Metal Crusher — Billing & Management System
-- Notes:
--   • Business-day reports align strictly to Asia/Colombo (UTC+05:30).
--   • Physical cash movement (gross receipts - actual cash refunds) is tracked
--     separately from clerical ENTRY_REVERSAL bookkeeping corrections.
--   • Physical cash refunds are attributed strictly to pa.performed_by_user_id
--     so another cashier's drawer is never debited when someone else pays out cash.
--   • Negative balances (REFUND_DUE) are never hidden or clamped to zero.
-- =============================================================================

-- 1. Operational & Security Audit Journal
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    action VARCHAR(50) NOT NULL CHECK (length(trim(action)) >= 3),
    entity_type VARCHAR(50) NOT NULL CHECK (length(trim(entity_type)) >= 2),
    entity_id VARCHAR(64) NOT NULL CHECK (length(trim(entity_id)) >= 1),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

-- 2. Authoritative Derived Invoice Ledger View
-- Only surfaces finalized ('ISSUED', 'CANCELLED') invoices; hides incomplete DRAFT rows.
CREATE OR REPLACE VIEW invoice_ledger_view AS
WITH payment_totals AS (
    SELECT
        invoice_id,
        COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2) AS gross_paid
    FROM payments
    GROUP BY invoice_id
),
adjustment_totals AS (
    SELECT
        py.invoice_id,
        COALESCE(SUM(pa.adjustment_amount) FILTER (WHERE pa.adjustment_type = 'ENTRY_REVERSAL'), 0.00)::NUMERIC(12, 2) AS total_entry_reversals,
        COALESCE(SUM(pa.adjustment_amount) FILTER (WHERE pa.adjustment_type = 'CASH_REFUND'), 0.00)::NUMERIC(12, 2) AS total_cash_refunded,
        COALESCE(SUM(pa.adjustment_amount), 0.00)::NUMERIC(12, 2) AS total_adjustments
    FROM payment_adjustments pa
    JOIN payments py ON py.id = pa.payment_id
    GROUP BY py.invoice_id
),
credit_totals AS (
    SELECT
        invoice_id,
        COALESCE(SUM(credit_amount), 0.00)::NUMERIC(12, 2) AS total_credited
    FROM credit_notes
    GROUP BY invoice_id
)
SELECT
    i.id AS invoice_id,
    i.invoice_number,
    i.customer_id,
    i.customer_name_snapshot,
    i.customer_phone_snapshot,
    i.customer_location_snapshot,
    i.has_transport,
    i.transport_fee,
    i.subtotal,
    i.grand_total AS original_grand_total,
    COALESCE(ct.total_credited, 0.00)::NUMERIC(12, 2) AS total_credited,
    (i.grand_total - COALESCE(ct.total_credited, 0.00))::NUMERIC(12, 2) AS effective_grand_total,
    COALESCE(pt.gross_paid, 0.00)::NUMERIC(12, 2) AS gross_recorded_receipts,
    COALESCE(at.total_entry_reversals, 0.00)::NUMERIC(12, 2) AS total_entry_reversals,
    (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_entry_reversals, 0.00))::NUMERIC(12, 2) AS corrected_net_receipts,
    COALESCE(at.total_cash_refunded, 0.00)::NUMERIC(12, 2) AS total_cash_refunded,
    (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))::NUMERIC(12, 2) AS effective_paid,
    -- Unclamped signed balance: > 0 means receivable due; < 0 means customer refund owed
    ((i.grand_total - COALESCE(ct.total_credited, 0.00))
        - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00)))::NUMERIC(12, 2) AS signed_balance,
    CASE
        WHEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))) > 0.00
        THEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00)))::NUMERIC(12, 2)
        ELSE 0.00::NUMERIC(12, 2)
    END AS balance_due,
    CASE
        WHEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))) < 0.00
        THEN ABS((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00)))::NUMERIC(12, 2)
        ELSE 0.00::NUMERIC(12, 2)
    END AS refund_due_to_customer,
    CASE
        WHEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))) < 0.00
            THEN 'REFUND_DUE'
        WHEN i.status = 'CANCELLED'
            THEN 'CANCELLED'
        WHEN ((i.grand_total - COALESCE(ct.total_credited, 0.00))
            - (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00))) = 0.00
            THEN 'PAID'
        WHEN (COALESCE(pt.gross_paid, 0.00) - COALESCE(at.total_adjustments, 0.00)) = 0.00
            THEN 'UNPAID'
        ELSE 'PARTIALLY_PAID'
    END AS payment_status,
    i.status AS invoice_status,
    i.issued_by_user_id,
    i.issued_at,
    DATE(i.issued_at AT TIME ZONE 'Asia/Colombo') AS business_date
FROM invoices i
LEFT JOIN payment_totals pt ON pt.invoice_id = i.id
LEFT JOIN adjustment_totals at ON at.invoice_id = i.id
LEFT JOIN credit_totals ct ON ct.invoice_id = i.id
WHERE i.status IN ('ISSUED', 'CANCELLED');

-- 3. Workshop Daily Cash Reconciliation View (Asia/Colombo)
-- Separates:
--   • physical_cash_movement = gross_recorded_receipts - cash_refunded_amount
--   • corrected_net_receipts = gross_recorded_receipts - entry_reversals_amount
--   • net_effective_cash     = gross_recorded_receipts - entry_reversals_amount - cash_refunded_amount
CREATE OR REPLACE VIEW daily_cash_reconciliation_view AS
WITH daily_keys AS (
    SELECT DATE(created_at AT TIME ZONE 'Asia/Colombo') AS business_date FROM payments
    UNION
    SELECT DATE(created_at AT TIME ZONE 'Asia/Colombo') AS business_date FROM payment_adjustments
),
daily_receipts AS (
    SELECT
        DATE(created_at AT TIME ZONE 'Asia/Colombo') AS business_date,
        COUNT(*) AS receipt_count,
        COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2) AS gross_recorded_receipts
    FROM payments
    GROUP BY DATE(created_at AT TIME ZONE 'Asia/Colombo')
),
daily_adjustments AS (
    SELECT
        DATE(created_at AT TIME ZONE 'Asia/Colombo') AS business_date,
        COUNT(*) FILTER (WHERE adjustment_type = 'ENTRY_REVERSAL') AS entry_reversal_count,
        COALESCE(SUM(adjustment_amount) FILTER (WHERE adjustment_type = 'ENTRY_REVERSAL'), 0.00)::NUMERIC(12, 2) AS entry_reversals_amount,
        COUNT(*) FILTER (WHERE adjustment_type = 'CASH_REFUND') AS cash_refund_count,
        COALESCE(SUM(adjustment_amount) FILTER (WHERE adjustment_type = 'CASH_REFUND'), 0.00)::NUMERIC(12, 2) AS cash_refunded_amount
    FROM payment_adjustments
    GROUP BY DATE(created_at AT TIME ZONE 'Asia/Colombo')
)
SELECT
    k.business_date,
    COALESCE(dr.receipt_count, 0) AS receipt_count,
    COALESCE(dr.gross_recorded_receipts, 0.00)::NUMERIC(12, 2) AS gross_recorded_receipts,
    COALESCE(da.entry_reversal_count, 0) AS entry_reversal_count,
    COALESCE(da.entry_reversals_amount, 0.00)::NUMERIC(12, 2) AS entry_reversals_amount,
    (COALESCE(dr.gross_recorded_receipts, 0.00)
        - COALESCE(da.entry_reversals_amount, 0.00))::NUMERIC(12, 2) AS corrected_net_receipts,
    COALESCE(da.cash_refund_count, 0) AS cash_refund_count,
    COALESCE(da.cash_refunded_amount, 0.00)::NUMERIC(12, 2) AS cash_refunded_amount,
    (COALESCE(dr.gross_recorded_receipts, 0.00)
        - COALESCE(da.cash_refunded_amount, 0.00))::NUMERIC(12, 2) AS physical_cash_movement,
    (COALESCE(dr.gross_recorded_receipts, 0.00)
        - COALESCE(da.entry_reversals_amount, 0.00)
        - COALESCE(da.cash_refunded_amount, 0.00))::NUMERIC(12, 2) AS net_effective_cash
FROM daily_keys k
LEFT JOIN daily_receipts dr ON dr.business_date = k.business_date
LEFT JOIN daily_adjustments da ON da.business_date = k.business_date;

-- 4. Per-User Daily Cash Reconciliation View (Asia/Colombo)
-- Pre-aggregates receipts, entry reversals, and physical cash refunds independently:
--   • Receipts accrue to payments.cashier_user_id on receipt date.
--   • Clerical ENTRY_REVERSAL adjusts the original payment cashier's corrected_net_receipts
--     on the reversal date WITHOUT altering physical_cash_movement.
--   • Physical CASH_REFUND deducts strictly from payment_adjustments.performed_by_user_id
--     on the refund date.
CREATE OR REPLACE VIEW cashier_shift_reconciliation_view AS
WITH user_shift_keys AS (
    SELECT
        cashier_user_id AS user_id,
        DATE(created_at AT TIME ZONE 'Asia/Colombo') AS shift_date
    FROM payments
    UNION
    SELECT
        py.cashier_user_id AS user_id,
        DATE(pa.created_at AT TIME ZONE 'Asia/Colombo') AS shift_date
    FROM payment_adjustments pa
    JOIN payments py ON py.id = pa.payment_id
    WHERE pa.adjustment_type = 'ENTRY_REVERSAL'
    UNION
    SELECT
        performed_by_user_id AS user_id,
        DATE(created_at AT TIME ZONE 'Asia/Colombo') AS shift_date
    FROM payment_adjustments
    WHERE adjustment_type = 'CASH_REFUND'
),
user_receipts AS (
    SELECT
        cashier_user_id AS user_id,
        DATE(created_at AT TIME ZONE 'Asia/Colombo') AS shift_date,
        COUNT(*) AS receipt_count,
        COALESCE(SUM(amount), 0.00)::NUMERIC(12, 2) AS gross_recorded_receipts
    FROM payments
    GROUP BY cashier_user_id, DATE(created_at AT TIME ZONE 'Asia/Colombo')
),
user_reversals AS (
    SELECT
        py.cashier_user_id AS user_id,
        DATE(pa.created_at AT TIME ZONE 'Asia/Colombo') AS shift_date,
        COUNT(*) AS entry_reversal_count,
        COALESCE(SUM(pa.adjustment_amount), 0.00)::NUMERIC(12, 2) AS entry_reversals_amount
    FROM payment_adjustments pa
    JOIN payments py ON py.id = pa.payment_id
    WHERE pa.adjustment_type = 'ENTRY_REVERSAL'
    GROUP BY py.cashier_user_id, DATE(pa.created_at AT TIME ZONE 'Asia/Colombo')
),
user_refunds AS (
    SELECT
        performed_by_user_id AS user_id,
        DATE(created_at AT TIME ZONE 'Asia/Colombo') AS shift_date,
        COUNT(*) AS cash_refund_count,
        COALESCE(SUM(adjustment_amount), 0.00)::NUMERIC(12, 2) AS cash_refunded_amount
    FROM payment_adjustments
    WHERE adjustment_type = 'CASH_REFUND'
    GROUP BY performed_by_user_id, DATE(created_at AT TIME ZONE 'Asia/Colombo')
)
SELECT
    u.id AS user_id,
    u.full_name,
    u.role AS user_role,
    k.shift_date,
    COALESCE(r.receipt_count, 0) AS receipt_count,
    COALESCE(r.gross_recorded_receipts, 0.00)::NUMERIC(12, 2) AS gross_recorded_receipts,
    COALESCE(rv.entry_reversal_count, 0) AS entry_reversal_count,
    COALESCE(rv.entry_reversals_amount, 0.00)::NUMERIC(12, 2) AS entry_reversals_amount,
    (COALESCE(r.gross_recorded_receipts, 0.00)
        - COALESCE(rv.entry_reversals_amount, 0.00))::NUMERIC(12, 2) AS corrected_net_receipts,
    COALESCE(rf.cash_refund_count, 0) AS cash_refund_count,
    COALESCE(rf.cash_refunded_amount, 0.00)::NUMERIC(12, 2) AS cash_refunded_amount,
    (COALESCE(r.gross_recorded_receipts, 0.00)
        - COALESCE(rf.cash_refunded_amount, 0.00))::NUMERIC(12, 2) AS physical_cash_movement,
    (COALESCE(r.gross_recorded_receipts, 0.00)
        - COALESCE(rv.entry_reversals_amount, 0.00)
        - COALESCE(rf.cash_refunded_amount, 0.00))::NUMERIC(12, 2) AS net_effective_cash
FROM user_shift_keys k
JOIN users u ON u.id = k.user_id
LEFT JOIN user_receipts r ON r.user_id = k.user_id AND r.shift_date = k.shift_date
LEFT JOIN user_reversals rv ON rv.user_id = k.user_id AND rv.shift_date = k.shift_date
LEFT JOIN user_refunds rf ON rf.user_id = k.user_id AND rf.shift_date = k.shift_date;

-- 5. Customer Balances & Receivables Summary View
CREATE OR REPLACE VIEW customer_balances_view AS
SELECT
    c.id AS customer_id,
    c.name AS customer_name,
    c.phone,
    c.location,
    COUNT(ilv.invoice_id) FILTER (WHERE ilv.invoice_status = 'ISSUED') AS active_invoice_count,
    COUNT(ilv.invoice_id) FILTER (WHERE ilv.invoice_status = 'CANCELLED') AS cancelled_invoice_count,
    COALESCE(SUM(ilv.effective_grand_total), 0.00)::NUMERIC(12, 2) AS total_billed,
    COALESCE(SUM(ilv.effective_paid), 0.00)::NUMERIC(12, 2) AS total_paid,
    COALESCE(SUM(ilv.balance_due), 0.00)::NUMERIC(12, 2) AS outstanding_balance,
    COALESCE(SUM(ilv.refund_due_to_customer), 0.00)::NUMERIC(12, 2) AS total_refund_due,
    MAX(ilv.issued_at) AS last_invoice_at
FROM customers c
LEFT JOIN invoice_ledger_view ilv ON ilv.customer_id = c.id
GROUP BY c.id, c.name, c.phone, c.location;
