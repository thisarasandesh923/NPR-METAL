-- Up Migration
-- Migration 014: Enforce CASH ONLY Salary Payments

-- Prevent changing the constraint if non-CASH records exist.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.salary_payments
        WHERE payment_method IS DISTINCT FROM 'CASH'
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce CASH ONLY: non-CASH salary payments exist';
    END IF;
END
$$;

-- Replace the existing payment method constraint.
ALTER TABLE public.salary_payments
DROP CONSTRAINT IF EXISTS salary_payments_payment_method_check;

ALTER TABLE public.salary_payments
ADD CONSTRAINT salary_payments_payment_method_check
CHECK (payment_method = 'CASH');
