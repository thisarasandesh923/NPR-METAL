import type {
  MaterialRow,
  PaymentStatus,
  PaymentCalculationResult,
  InvoiceTotals,
} from "../types/invoice.ts";

/**
 * CLIENT-SIDE PROTOTYPE CALCULATION UTILITIES
 *
 * NOTE: These client-side calculation utilities provide responsive typing previews
 * in the UI. In production, ALL financial arithmetic (subtotals, transport charges,
 * grand totals, payment limits, and outstanding balances) is authoritatively calculated
 * and validated on the backend inside PostgreSQL database transactions using exact
 * NUMERIC(12, 2) fixed-point precision.
 */

export function calculateSubtotal(items: MaterialRow[]): number {
  return items.reduce((sum, item) => {
    const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 0;
    const price = Number.isFinite(item.price) && item.price >= 0 ? item.price : 0;
    return sum + qty * price;
  }, 0);
}

export function calculateGrandTotal(
  subtotal: number,
  withTransport: boolean,
  transportFee: number
): number {
  const safeSubtotal = Number.isFinite(subtotal) && subtotal >= 0 ? subtotal : 0;
  const safeFee =
    withTransport && Number.isFinite(transportFee) && transportFee > 0 ? transportFee : 0;
  return safeSubtotal + safeFee;
}

export function calculatePaidAndBalance(
  cashReceived: number,
  grandTotal: number
): PaymentCalculationResult {
  const safeCash = Number.isFinite(cashReceived) ? Math.max(cashReceived, 0) : 0;
  const safeGrandTotal = Number.isFinite(grandTotal) ? Math.max(grandTotal, 0) : 0;
  const isOverpayment = safeCash > safeGrandTotal;
  const overpaymentAmount = isOverpayment ? safeCash - safeGrandTotal : 0;
  const paidAmount = Math.min(safeCash, safeGrandTotal);
  const balance = Math.max(safeGrandTotal - paidAmount, 0);

  return {
    paidAmount,
    balance,
    isOverpayment,
    overpaymentAmount,
  };
}

export function determinePaymentStatus(
  paidAmount: number,
  balance: number,
  isOverpayment = false
): PaymentStatus {
  if (isOverpayment) {
    return "Invalid (Overpaid)";
  }
  if (paidAmount <= 0) {
    return "Unpaid";
  }
  if (balance <= 0) {
    return "Paid";
  }
  return "Partial";
}

export function calculateInvoiceTotals(
  items: MaterialRow[],
  withTransport: boolean,
  transportFee: number,
  cashReceived: number
): InvoiceTotals {
  const subtotal = calculateSubtotal(items);
  const grandTotal = calculateGrandTotal(subtotal, withTransport, transportFee);
  const { paidAmount, balance, isOverpayment, overpaymentAmount } = calculatePaidAndBalance(
    cashReceived,
    grandTotal
  );
  const paymentStatus = determinePaymentStatus(paidAmount, balance, isOverpayment);

  return {
    subtotal,
    grandTotal,
    paidAmount,
    balance,
    paymentStatus,
    isOverpayment,
    overpaymentAmount,
  };
}
