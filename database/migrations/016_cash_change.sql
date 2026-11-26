
-- Up Migration
-- Migration 016: Cash Tendered and Change Returned
-- NPR Metal Crusher

-- Add optional cash transaction details.
-- Existing payment records remain unchanged.

ALTER TABLE public.payments
ADD COLUMN cash_tendered NUMERIC(12, 2),
ADD COLUMN change_returned NUMERIC(12, 2);

-- Ensure the cash transaction is financially consistent.

ALTER TABLE public.payments
ADD CONSTRAINT chk_payments_cash_change
CHECK (
    (
        cash_tendered IS NULL
        AND change_returned IS NULL
    )
    OR
    (
        cash_tendered IS NOT NULL
        AND change_returned IS NOT NULL
        AND cash_tendered >= amount
        AND change_returned >= 0
        AND change_returned = cash_tendered - amount
    )
);
