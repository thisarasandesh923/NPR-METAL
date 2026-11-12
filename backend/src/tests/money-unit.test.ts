import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeLineTotalCents,
  formatScaledDecimal,
  parseScaledDecimal,
} from "../utils/money.js";

describe("Billing MVP — Fixed-Point BigInt Money Utilities", () => {
  it("parses and formats exact decimals without IEEE-754 floating-point drift", () => {
    const a = parseScaledDecimal("0.1", 2, "a");
    const b = parseScaledDecimal("0.2", 2, "b");
    assert.equal(formatScaledDecimal(a + b, 2), "0.30");

    const qty = parseScaledDecimal("1.125", 3, "quantity");
    const price = parseScaledDecimal("12500.50", 2, "price");
    // 1.125 * 12500.50 = 14063.0625 -> rounds half-up to 14063.06
    assert.equal(formatScaledDecimal(computeLineTotalCents(qty, price), 2), "14063.06");

    // 0.005 rounding check: 0.001 m³ * 5.00 = 0.005 -> 0.01
    const qHalf = parseScaledDecimal("0.001", 3, "quantity");
    const pHalf = parseScaledDecimal("5.00", 2, "price");
    assert.equal(formatScaledDecimal(computeLineTotalCents(qHalf, pHalf), 2), "0.01");
  });

  it("rejects negative numbers, scientific notation, and excess decimal places", () => {
    assert.throws(() => parseScaledDecimal("-10.00", 2, "amount"));
    assert.throws(() => parseScaledDecimal("1e5", 2, "amount"));
    assert.throws(() => parseScaledDecimal("10.123", 2, "amount"));
    assert.throws(() => parseScaledDecimal("1.2345", 3, "quantity"));
  });
});
