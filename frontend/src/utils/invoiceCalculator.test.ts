import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateSubtotal,
  calculateGrandTotal,
  calculatePaidAndBalance,
  determinePaymentStatus,
  calculateInvoiceTotals,
} from "./invoiceCalculator.ts";
import type { MaterialRow } from "../types/invoice.ts";

describe("invoiceCalculator utilities", () => {
  const sampleItems: MaterialRow[] = [
    { id: 1, material: '3/4"', quantity: 5, price: 12000 }, // 60,000
    { id: 2, material: "Dust", quantity: 2.5, price: 8000 }, // 20,000
  ];

  it("calculates subtotal correctly from material rows", () => {
    const subtotal = calculateSubtotal(sampleItems);
    assert.equal(subtotal, 80000);
  });

  it("handles empty items array gracefully with 0 subtotal", () => {
    const subtotal = calculateSubtotal([]);
    assert.equal(subtotal, 0);
  });

  it("adds transport fee when withTransport is true", () => {
    const total = calculateGrandTotal(80000, true, 7500);
    assert.equal(total, 87500);
  });

  it("ignores transport fee when withTransport is false", () => {
    const total = calculateGrandTotal(80000, false, 7500);
    assert.equal(total, 80000);
  });

  it("calculates paidAmount and balance correctly for partial payment", () => {
    const result = calculatePaidAndBalance(50000, 87500);
    assert.equal(result.paidAmount, 50000);
    assert.equal(result.balance, 37500);
    assert.equal(result.isOverpayment, false);
    assert.equal(result.overpaymentAmount, 0);
  });

  it("flags overpayment, caps paidAmount, and calculates excess when cash exceeds grandTotal", () => {
    const result = calculatePaidAndBalance(100000, 87500);
    assert.equal(result.paidAmount, 87500);
    assert.equal(result.balance, 0);
    assert.equal(result.isOverpayment, true);
    assert.equal(result.overpaymentAmount, 12500);
  });

  it("determines correct payment statuses (Unpaid, Paid, Partial, Invalid Overpaid)", () => {
    assert.equal(determinePaymentStatus(0, 87500), "Unpaid");
    assert.equal(determinePaymentStatus(87500, 0), "Paid");
    assert.equal(determinePaymentStatus(50000, 37500), "Partial");
    assert.equal(determinePaymentStatus(87500, 0, true), "Invalid (Overpaid)");
  });

  it("calculates entire invoice summary atomically with valid payment", () => {
    const summary = calculateInvoiceTotals(sampleItems, true, 7500, 50000);
    assert.equal(summary.subtotal, 80000);
    assert.equal(summary.grandTotal, 87500);
    assert.equal(summary.paidAmount, 50000);
    assert.equal(summary.balance, 37500);
    assert.equal(summary.paymentStatus, "Partial");
    assert.equal(summary.isOverpayment, false);
    assert.equal(summary.overpaymentAmount, 0);
  });

  it("calculates entire invoice summary with overpayment warning state", () => {
    const summary = calculateInvoiceTotals(sampleItems, true, 7500, 100000);
    assert.equal(summary.subtotal, 80000);
    assert.equal(summary.grandTotal, 87500);
    assert.equal(summary.paidAmount, 87500);
    assert.equal(summary.balance, 0);
    assert.equal(summary.paymentStatus, "Invalid (Overpaid)");
    assert.equal(summary.isOverpayment, true);
    assert.equal(summary.overpaymentAmount, 12500);
  });
});
