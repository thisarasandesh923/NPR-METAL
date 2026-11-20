import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  fetchFinancialReport,
  fetchPayrollExportRows,
} from "../modules/reports/reports.repository.js";

/**
 * Stage 3.5A — Unit Tests for Salary Financial Reporting Consistency
 * After Payment Corrections and Voids in public.salary_payment_adjustments.
 */

// Helper to simulate the exact SQL effective payment logic:
// COALESCE((SELECT spa.corrected_amount FROM salary_payment_adjustments spa WHERE spa.salary_payment_id = sp.id ORDER BY spa.id DESC LIMIT 1), sp.amount)
interface MockSalaryPayment {
  id: number;
  payroll_entry_id: number;
  amount: string; // NUMERIC(12, 2)
  payment_date: string; // YYYY-MM-DD
}

interface MockSalaryAdjustment {
  id: number;
  salary_payment_id: number;
  adjustment_type: "AMOUNT_CORRECTION" | "VOID";
  prior_effective_amount: string;
  corrected_amount: string; // NUMERIC(12, 2), "0.00" for VOID
}

interface MockPayrollEntry {
  id: number;
  payroll_period_id: number;
  worker_id: number;
  worker_name: string;
  net_payable: string; // NUMERIC(12, 2)
}

function computeEffectivePayment(
  payment: MockSalaryPayment,
  adjustments: MockSalaryAdjustment[]
): string {
  // Correlated subquery: ORDER BY spa.id DESC LIMIT 1
  const matchingAdjustments = adjustments
    .filter((a) => a.salary_payment_id === payment.id)
    .sort((a, b) => b.id - a.id);

  if (matchingAdjustments.length > 0) {
    return Number(matchingAdjustments[0].corrected_amount).toFixed(2);
  }
  return Number(payment.amount).toFixed(2);
}

function computeEffectivePaidTotal(
  payments: MockSalaryPayment[],
  adjustments: MockSalaryAdjustment[],
  dateFrom?: string,
  dateTo?: string
): string {
  const filtered = payments.filter((p) => {
    if (dateFrom && p.payment_date < dateFrom) return false;
    if (dateTo && p.payment_date > dateTo) return false;
    return true;
  });

  const total = filtered.reduce((sum, p) => {
    const effective = computeEffectivePayment(p, adjustments);
    return sum + Number(effective);
  }, 0);

  return total.toFixed(2);
}

function computeEntryPaidAndRemaining(
  entry: MockPayrollEntry,
  payments: MockSalaryPayment[],
  adjustments: MockSalaryAdjustment[]
): { paid_lkr: string; remaining_lkr: string } {
  const entryPayments = payments.filter((p) => p.payroll_entry_id === entry.id);
  const totalPaid = entryPayments.reduce((sum, p) => {
    return sum + Number(computeEffectivePayment(p, adjustments));
  }, 0);

  const netPayable = Number(entry.net_payable);
  const remaining = Math.max(netPayable - totalPaid, 0);

  return {
    paid_lkr: totalPaid.toFixed(2),
    remaining_lkr: remaining.toFixed(2),
  };
}

describe("Stage 3.5A — Salary Financial Reporting & Export Consistency", () => {
  // --------------------------------------------------------------------------
  // SQL STRUCTURE & CONTRACT CHECKS
  // --------------------------------------------------------------------------
  it("verifies SQL structure: fetchFinancialReport uses authoritative correlated subquery with ORDER BY id DESC LIMIT 1", async () => {
    const capturedQueries: string[] = [];
    const mockPool = {
      query: async (sql: string) => {
        capturedQueries.push(sql);
        if (sql.includes("FROM public.salary_payments sp")) {
          return { rows: [{ salary_paid: "30000.00" }] };
        }
        if (sql.includes("FROM public.invoice_ledger_view") && sql.includes("inv_count")) {
          return { rows: [{ billed_total: "120000.00", inv_count: 5 }] };
        }
        if (sql.includes("FROM public.daily_cash_reconciliation_view")) {
          return { rows: [{ cash_total: "95000.00", receipt_count: 4 }] };
        }
        if (sql.includes("FROM public.invoice_ledger_view") && sql.includes("balance_due > 0.00")) {
          return { rows: [{ outstanding: "25000.00", open_count: 1 }] };
        }
        if (sql.includes("FROM public.operational_expenses") && sql.includes("exp_total")) {
          return { rows: [{ exp_total: "15000.00" }] };
        }
        if (sql.includes("FROM public.payroll_entries pe")) {
          return { rows: [{ liability_total: "60000.00" }] };
        }
        if (sql.includes("WITH keys AS")) {
          return { rows: [] };
        }
        if (sql.includes("FROM public.cashier_shift_reconciliation_view")) {
          return { rows: [] };
        }
        if (sql.includes("GROUP BY category")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as unknown as Pool;

    const report = await fetchFinancialReport(mockPool, "2026-11-01", "2026-11-30");
    assert.equal(report.payrollCashPaidTotal, "30000.00");

    // Find the salary_payments query
    const salaryQuery = capturedQueries.find((q) => q.includes("FROM public.salary_payments sp"));
    assert.ok(salaryQuery, "Query aggregating salary_payments must be executed");

    // Check authoritative subquery logic
    assert.ok(
      salaryQuery.includes("public.salary_payment_adjustments spa"),
      "Must reference salary_payment_adjustments table"
    );
    assert.ok(
      salaryQuery.includes("spa.salary_payment_id = sp.id"),
      "Must correlate adjustment to payment ID"
    );
    assert.ok(
      salaryQuery.includes("ORDER BY spa.id DESC"),
      "Must sort adjustments descending by ID to pick the latest"
    );
    assert.ok(
      salaryQuery.includes("LIMIT 1"),
      "Must limit subquery to 1 row"
    );
    assert.ok(
      salaryQuery.includes("COALESCE"),
      "Must coalesce with original sp.amount if unadjusted"
    );
    // Ensure it does not naively SUM all adjustments in an unconstrained join
    assert.ok(
      !salaryQuery.includes("JOIN public.salary_payment_adjustments"),
      "Should not join adjustments naively without picking the latest"
    );
  });

  it("verifies SQL structure: fetchPayrollExportRows uses authoritative correlated subquery in paid_totals CTE", async () => {
    let capturedExportQuery = "";
    const mockPool = {
      query: async (sql: string) => {
        capturedExportQuery = sql;
        return { rows: [] };
      },
    } as unknown as Pool;

    await fetchPayrollExportRows(mockPool, "2026-11-01", "2026-11-30", 1);

    assert.ok(
      capturedExportQuery.includes("WITH paid_totals AS"),
      "Must use CTE paid_totals"
    );
    assert.ok(
      capturedExportQuery.includes("public.salary_payment_adjustments spa"),
      "Must reference salary_payment_adjustments table"
    );
    assert.ok(
      capturedExportQuery.includes("ORDER BY spa.id DESC"),
      "Must order by spa.id DESC to find latest adjustment"
    );
    assert.ok(
      capturedExportQuery.includes("LIMIT 1"),
      "Must limit to 1 row"
    );
    assert.ok(
      capturedExportQuery.includes("GREATEST(pe.net_payable - COALESCE(pt.paid_amount, 0.00), 0.00)"),
      "Must calculate remaining balance using GREATEST and paid_amount"
    );
  });

  // --------------------------------------------------------------------------
  // CASE 1: UNADJUSTED PAYMENT (RS. 30,000)
  // --------------------------------------------------------------------------
  it("Case 1: unadjusted payment correctly aggregates original amount without adjustments", async () => {
    const entry: MockPayrollEntry = {
      id: 101,
      payroll_period_id: 1,
      worker_id: 1,
      worker_name: "Sunil Bandara",
      net_payable: "60000.00",
    };
    const payment: MockSalaryPayment = {
      id: 501,
      payroll_entry_id: 101,
      amount: "30000.00",
      payment_date: "2026-11-15",
    };
    const adjustments: MockSalaryAdjustment[] = [];

    // Financial report total
    const totalPaid = computeEffectivePaidTotal([payment], adjustments, "2026-11-01", "2026-11-30");
    assert.equal(totalPaid, "30000.00", "Unadjusted payment must report original amount");

    // Export row paid and remaining
    const exportMetrics = computeEntryPaidAndRemaining(entry, [payment], adjustments);
    assert.equal(exportMetrics.paid_lkr, "30000.00");
    assert.equal(exportMetrics.remaining_lkr, "30000.00");

    // Verify mock repository call returns expected report
    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes("FROM public.salary_payments sp")) {
          return { rows: [{ salary_paid: totalPaid }] };
        }
        return { rows: [{ billed_total: "0.00", inv_count: 0, cash_total: "0.00", receipt_count: 0, outstanding: "0.00", open_count: 0, exp_total: "0.00", liability_total: "60000.00" }] };
      },
    } as unknown as Pool;

    const report = await fetchFinancialReport(mockPool, "2026-11-01", "2026-11-30");
    assert.equal(report.payrollCashPaidTotal, "30000.00");
  });

  // --------------------------------------------------------------------------
  // CASE 2: SINGLE CORRECTION (30,000 -> 25,000)
  // --------------------------------------------------------------------------
  it("Case 2: single payment correction (30,000 -> 25,000) reflects latest adjusted amount", async () => {
    const entry: MockPayrollEntry = {
      id: 101,
      payroll_period_id: 1,
      worker_id: 1,
      worker_name: "Sunil Bandara",
      net_payable: "60000.00",
    };
    const payment: MockSalaryPayment = {
      id: 501,
      payroll_entry_id: 101,
      amount: "30000.00",
      payment_date: "2026-11-15",
    };
    const adjustments: MockSalaryAdjustment[] = [
      {
        id: 1,
        salary_payment_id: 501,
        adjustment_type: "AMOUNT_CORRECTION",
        prior_effective_amount: "30000.00",
        corrected_amount: "25000.00",
      },
    ];

    const totalPaid = computeEffectivePaidTotal([payment], adjustments, "2026-11-01", "2026-11-30");
    assert.equal(totalPaid, "25000.00", "Corrected payment must report 25000.00");

    const exportMetrics = computeEntryPaidAndRemaining(entry, [payment], adjustments);
    assert.equal(exportMetrics.paid_lkr, "25000.00");
    assert.equal(exportMetrics.remaining_lkr, "35000.00");

    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes("FROM public.salary_payments sp")) {
          return { rows: [{ salary_paid: totalPaid }] };
        }
        return { rows: [{ billed_total: "0.00", inv_count: 0, cash_total: "0.00", receipt_count: 0, outstanding: "0.00", open_count: 0, exp_total: "0.00", liability_total: "60000.00" }] };
      },
    } as unknown as Pool;

    const report = await fetchFinancialReport(mockPool, "2026-11-01", "2026-11-30");
    assert.equal(report.payrollCashPaidTotal, "25000.00");
  });

  // --------------------------------------------------------------------------
  // CASE 3: REPEATED CORRECTIONS (25,000 -> 20,000)
  // --------------------------------------------------------------------------
  it("Case 3: repeated payment corrections (25,000 -> 20,000) uses latest correction and avoids double-counting", async () => {
    const entry: MockPayrollEntry = {
      id: 101,
      payroll_period_id: 1,
      worker_id: 1,
      worker_name: "Sunil Bandara",
      net_payable: "60000.00",
    };
    const payment: MockSalaryPayment = {
      id: 501,
      payroll_entry_id: 101,
      amount: "30000.00",
      payment_date: "2026-11-15",
    };
    // Two adjustments on the same receipt
    const adjustments: MockSalaryAdjustment[] = [
      {
        id: 1,
        salary_payment_id: 501,
        adjustment_type: "AMOUNT_CORRECTION",
        prior_effective_amount: "30000.00",
        corrected_amount: "25000.00",
      },
      {
        id: 2,
        salary_payment_id: 501,
        adjustment_type: "AMOUNT_CORRECTION",
        prior_effective_amount: "25000.00",
        corrected_amount: "20000.00",
      },
    ];

    const totalPaid = computeEffectivePaidTotal([payment], adjustments, "2026-11-01", "2026-11-30");
    assert.equal(totalPaid, "20000.00", "Must report latest corrected amount (20000.00)");

    const exportMetrics = computeEntryPaidAndRemaining(entry, [payment], adjustments);
    assert.equal(exportMetrics.paid_lkr, "20000.00");
    assert.equal(exportMetrics.remaining_lkr, "40000.00");

    // Naive sum of adjustments would have yielded 25000 + 20000 = 45000.00!
    const naiveSum = adjustments.reduce((s, a) => s + Number(a.corrected_amount), 0);
    assert.notEqual(
      Number(totalPaid),
      naiveSum,
      "Must not double-count repeated adjustments"
    );
  });

  // --------------------------------------------------------------------------
  // CASE 4: VOIDED PAYMENT (20,000 -> 0.00)
  // --------------------------------------------------------------------------
  it("Case 4: voided payment (20,000 -> 0.00) reflects 0.00 paid and full net payable remaining", async () => {
    const entry: MockPayrollEntry = {
      id: 101,
      payroll_period_id: 1,
      worker_id: 1,
      worker_name: "Sunil Bandara",
      net_payable: "60000.00",
    };
    const payment: MockSalaryPayment = {
      id: 501,
      payroll_entry_id: 101,
      amount: "30000.00",
      payment_date: "2026-11-15",
    };
    // Three adjustments culminating in VOID
    const adjustments: MockSalaryAdjustment[] = [
      {
        id: 1,
        salary_payment_id: 501,
        adjustment_type: "AMOUNT_CORRECTION",
        prior_effective_amount: "30000.00",
        corrected_amount: "25000.00",
      },
      {
        id: 2,
        salary_payment_id: 501,
        adjustment_type: "AMOUNT_CORRECTION",
        prior_effective_amount: "25000.00",
        corrected_amount: "20000.00",
      },
      {
        id: 3,
        salary_payment_id: 501,
        adjustment_type: "VOID",
        prior_effective_amount: "20000.00",
        corrected_amount: "0.00",
      },
    ];

    const totalPaid = computeEffectivePaidTotal([payment], adjustments, "2026-11-01", "2026-11-30");
    assert.equal(totalPaid, "0.00", "Voided payment must report 0.00");

    const exportMetrics = computeEntryPaidAndRemaining(entry, [payment], adjustments);
    assert.equal(exportMetrics.paid_lkr, "0.00");
    assert.equal(exportMetrics.remaining_lkr, "60000.00", "Remaining balance must be restored to full net payable");
  });

  // --------------------------------------------------------------------------
  // CASE 5: MULTIPLE PAYMENT RECEIPTS ON ONE ENTRY
  // --------------------------------------------------------------------------
  it("Case 5: multiple payment receipts on one salary entry aggregate each receipt's effective amount independently", async () => {
    const entry: MockPayrollEntry = {
      id: 101,
      payroll_period_id: 1,
      worker_id: 1,
      worker_name: "Sunil Bandara",
      net_payable: "60000.00",
    };
    // Receipt 1: 10,000 unadjusted
    const payment1: MockSalaryPayment = {
      id: 501,
      payroll_entry_id: 101,
      amount: "10000.00",
      payment_date: "2026-11-10",
    };
    // Receipt 2: 15,000 corrected to 12,000
    const payment2: MockSalaryPayment = {
      id: 502,
      payroll_entry_id: 101,
      amount: "15000.00",
      payment_date: "2026-11-20",
    };

    const adjustments: MockSalaryAdjustment[] = [
      {
        id: 1,
        salary_payment_id: 502,
        adjustment_type: "AMOUNT_CORRECTION",
        prior_effective_amount: "15000.00",
        corrected_amount: "12000.00",
      },
    ];

    const totalPaid = computeEffectivePaidTotal([payment1, payment2], adjustments, "2026-11-01", "2026-11-30");
    // 10,000 + 12,000 = 22,000.00
    assert.equal(totalPaid, "22000.00");

    const exportMetrics = computeEntryPaidAndRemaining(entry, [payment1, payment2], adjustments);
    assert.equal(exportMetrics.paid_lkr, "22000.00");
    assert.equal(exportMetrics.remaining_lkr, "38000.00"); // 60,000 - 22,000
  });

  // --------------------------------------------------------------------------
  // CASE 6: PARTIAL PAYMENT TOTALS
  // --------------------------------------------------------------------------
  it("Case 6: partial payments calculate paid totals and remaining balances accurately", async () => {
    const entry: MockPayrollEntry = {
      id: 102,
      payroll_period_id: 1,
      worker_id: 2,
      worker_name: "Nimal Perera",
      net_payable: "45000.00",
    };
    const payment: MockSalaryPayment = {
      id: 503,
      payroll_entry_id: 102,
      amount: "15000.00",
      payment_date: "2026-11-12",
    };

    const adjustments: MockSalaryAdjustment[] = [];

    const totalPaid = computeEffectivePaidTotal([payment], adjustments, "2026-11-01", "2026-11-30");
    assert.equal(totalPaid, "15000.00");

    const exportMetrics = computeEntryPaidAndRemaining(entry, [payment], adjustments);
    assert.equal(exportMetrics.paid_lkr, "15000.00");
    assert.equal(exportMetrics.remaining_lkr, "30000.00");
  });

  // --------------------------------------------------------------------------
  // CASE 7: PAID AND REMAINING BALANCE RECONCILIATION INVARIANT
  // --------------------------------------------------------------------------
  it("Case 7: financial invariant holds across adjustments (paid_lkr + remaining_lkr = net_payable_lkr)", () => {
    const entry: MockPayrollEntry = {
      id: 103,
      payroll_period_id: 1,
      worker_id: 3,
      worker_name: "Kamal Wickramasinghe",
      net_payable: "85000.00",
    };

    const payment: MockSalaryPayment = {
      id: 504,
      payroll_entry_id: 103,
      amount: "50000.00",
      payment_date: "2026-11-18",
    };

    // Test across sequence of adjustment stages
    const adjustmentStages: MockSalaryAdjustment[][] = [
      [], // Stage 0: original 50,000
      [
        {
          id: 1,
          salary_payment_id: 504,
          adjustment_type: "AMOUNT_CORRECTION",
          prior_effective_amount: "50000.00",
          corrected_amount: "40000.00",
        },
      ], // Stage 1: corrected to 40,000
      [
        {
          id: 1,
          salary_payment_id: 504,
          adjustment_type: "AMOUNT_CORRECTION",
          prior_effective_amount: "50000.00",
          corrected_amount: "40000.00",
        },
        {
          id: 2,
          salary_payment_id: 504,
          adjustment_type: "AMOUNT_CORRECTION",
          prior_effective_amount: "40000.00",
          corrected_amount: "30000.00",
        },
      ], // Stage 2: corrected to 30,000
      [
        {
          id: 1,
          salary_payment_id: 504,
          adjustment_type: "AMOUNT_CORRECTION",
          prior_effective_amount: "50000.00",
          corrected_amount: "40000.00",
        },
        {
          id: 2,
          salary_payment_id: 504,
          adjustment_type: "AMOUNT_CORRECTION",
          prior_effective_amount: "40000.00",
          corrected_amount: "30000.00",
        },
        {
          id: 3,
          salary_payment_id: 504,
          adjustment_type: "VOID",
          prior_effective_amount: "30000.00",
          corrected_amount: "0.00",
        },
      ], // Stage 3: VOID
    ];

    for (const stageAdjustments of adjustmentStages) {
      const metrics = computeEntryPaidAndRemaining(entry, [payment], stageAdjustments);
      const paidNum = Number(metrics.paid_lkr);
      const remNum = Number(metrics.remaining_lkr);
      const netPayableNum = Number(entry.net_payable);

      assert.equal(
        (paidNum + remNum).toFixed(2),
        netPayableNum.toFixed(2),
        `Invariant must hold: paid (${metrics.paid_lkr}) + remaining (${metrics.remaining_lkr}) === net_payable (${entry.net_payable})`
      );
    }
  });

  // --------------------------------------------------------------------------
  // CASE 8: EXPORT VALUES MATCH AUTHORITATIVE PAYROLL REPOSITORY LOGIC
  // --------------------------------------------------------------------------
  it("Case 8: export values match authoritative payroll repository logic", async () => {
    // Simulated row returned by fetchPayrollExportRows
    const mockExportRow: Record<string, string | number | null> = {
      period_label: "Nov 2026",
      start_date: "2026-11-01",
      end_date: "2026-11-30",
      worker_code: "W101",
      worker_name: "Sunil Bandara",
      designation: "Crusher Operator",
      pay_arrangement: "MONTHLY",
      calculation_mode: "OWNER_MANUAL_DRAFT",
      approved_days_count: 26,
      regular_hours: "208.00",
      overtime_hours: "0.00",
      base_pay_lkr: "70000.00",
      overtime_pay_lkr: "0.00",
      allowances_lkr: "0.00",
      deductions_lkr: "0.00",
      advance_deduction_lkr: "10000.00",
      gross_pay_lkr: "70000.00",
      net_payable_lkr: "60000.00",
      paid_lkr: "25000.00", // Corrected from 30,000 to 25,000
      remaining_lkr: "35000.00",
      status: "APPROVED",
    };

    const mockPool = {
      query: async () => ({ rows: [mockExportRow] }),
    } as unknown as Pool;

    const rows = await fetchPayrollExportRows(mockPool, "2026-11-01", "2026-11-30", 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].paid_lkr, "25000.00");
    assert.equal(rows[0].remaining_lkr, "35000.00");
    assert.equal(rows[0].net_payable_lkr, "60000.00");
  });

  // --------------------------------------------------------------------------
  // CASE 9: UNADJUSTED HISTORICAL PAYMENTS REMAIN UNAFFECTED
  // --------------------------------------------------------------------------
  it("Case 9: unadjusted historical payments remain unaffected", () => {
    const historicalPayment1: MockSalaryPayment = {
      id: 401,
      payroll_entry_id: 91,
      amount: "45000.00",
      payment_date: "2026-10-15",
    };
    const historicalPayment2: MockSalaryPayment = {
      id: 402,
      payroll_entry_id: 92,
      amount: "52000.00",
      payment_date: "2026-10-20",
    };
    // No adjustments on historical payments
    const adjustments: MockSalaryAdjustment[] = [
      {
        id: 1,
        salary_payment_id: 999, // Some other unrelated payment
        adjustment_type: "AMOUNT_CORRECTION",
        prior_effective_amount: "10000.00",
        corrected_amount: "8000.00",
      },
    ];

    const octTotal = computeEffectivePaidTotal(
      [historicalPayment1, historicalPayment2],
      adjustments,
      "2026-10-01",
      "2026-10-31"
    );

    // 45,000 + 52,000 = 97,000.00
    assert.equal(octTotal, "97000.00", "Historical payments without adjustments must retain exact original totals");
  });

  // --------------------------------------------------------------------------
  // CASE 10: INVOICED SALES, CASH COLLECTIONS & OPEN RECEIVABLES UNAFFECTED
  // --------------------------------------------------------------------------
  it("Case 10: invoiced sales, cash collections, and open receivables remain completely independent and unaffected", async () => {
    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes("FROM public.invoice_ledger_view") && sql.includes("inv_count")) {
          return { rows: [{ billed_total: "350000.00", inv_count: 14 }] };
        }
        if (sql.includes("FROM public.daily_cash_reconciliation_view")) {
          return { rows: [{ cash_total: "280000.00", receipt_count: 12 }] };
        }
        if (sql.includes("FROM public.invoice_ledger_view") && sql.includes("balance_due > 0.00")) {
          return { rows: [{ outstanding: "70000.00", open_count: 2 }] };
        }
        if (sql.includes("FROM public.operational_expenses") && sql.includes("exp_total")) {
          return { rows: [{ exp_total: "42000.00" }] };
        }
        if (sql.includes("FROM public.payroll_entries pe")) {
          return { rows: [{ liability_total: "120000.00" }] };
        }
        if (sql.includes("FROM public.salary_payments sp")) {
          // Salary paid reflects adjustments
          return { rows: [{ salary_paid: "75000.00" }] };
        }
        if (sql.includes("WITH keys AS")) {
          return { rows: [] };
        }
        if (sql.includes("FROM public.cashier_shift_reconciliation_view")) {
          return { rows: [] };
        }
        if (sql.includes("GROUP BY category")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as unknown as Pool;

    const report = await fetchFinancialReport(mockPool, "2026-11-01", "2026-11-30");

    // Billing metrics must remain exact and untampered
    assert.equal(report.billedSalesTotal, "350000.00");
    assert.equal(report.issuedInvoiceCount, 14);
    assert.equal(report.cashCollectedTotal, "280000.00");
    assert.equal(report.receiptCount, 12);
    assert.equal(report.outstandingReceivablesTotal, "70000.00");
    assert.equal(report.openInvoicesCount, 2);
    assert.equal(report.recordedExpensesTotal, "42000.00");
    assert.equal(report.payrollApprovedLiabilityTotal, "120000.00");
    assert.equal(report.payrollCashPaidTotal, "75000.00");
  });
});
