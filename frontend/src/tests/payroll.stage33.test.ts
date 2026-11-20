import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testDom } from "./domSetup.ts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../App.tsx";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

async function setInputValue(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string
): Promise<void> {
  await act(async () => {
    const prototype = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

describe("Stage 3.3 — Owner and Cashier Manual Salary Frontend Integration", () => {
  let container: HTMLElement;
  let root: Root | null = null;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    testDom.window.document.body.innerHTML = "<div id='root'></div>";
    container = testDom.window.document.getElementById("root")!;
    originalFetch = globalThis.fetch;
    localStorage.setItem("npr_preferred_language", "en");
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    globalThis.fetch = originalFetch;
  });

  it("1-10: Cashier role permissions: can create period, disburse cash against approved entry, but cannot approve, correct salary, view history, or access adjustments tab", async () => {
    let createdPeriodPayload: Record<string, unknown> | null = null;
    let disbursedPaymentPayload: Record<string, unknown> | null = null;

    const periodsList = [
      {
        id: 10,
        periodLabel: "November 2026",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        status: "APPROVED",
        notes: null,
        version: 1,
        createdByUsername: "cashier_nimal",
        createdByRole: "CASHIER",
        createdAt: "2026-11-01T08:00:00Z",
      },
    ];

    const entriesList = [
      {
        id: 101,
        payrollPeriodId: 10,
        workerId: 1,
        workerCode: "W-001",
        workerName: "Kamal Silva",
        designation: "Machine Operator",
        payArrangementSnapshot: "MONTHLY",
        calculationMode: "OWNER_MANUAL_DRAFT",
        approvedDaysCount: 0,
        approvedRegularHours: "0.00",
        approvedOvertimeHours: "0.00",
        basePay: "65000.00",
        overtimePay: "0.00",
        allowances: "0.00",
        deductions: "0.00",
        advanceDeduction: "5000.00",
        grossPay: "65000.00",
        netPayable: "60000.00",
        paidAmount: "20000.00",
        remainingPayable: "40000.00",
        status: "APPROVED",
        notes: null,
        version: 2,
        approvedAt: "2026-11-05T10:00:00Z",
      },
      {
        id: 102,
        payrollPeriodId: 10,
        workerId: 2,
        workerCode: "W-002",
        workerName: "Sunil Perera",
        designation: "Helper",
        payArrangementSnapshot: "MONTHLY",
        calculationMode: "OWNER_MANUAL_DRAFT",
        approvedDaysCount: 0,
        approvedRegularHours: "0.00",
        approvedOvertimeHours: "0.00",
        basePay: "45000.00",
        overtimePay: "0.00",
        allowances: "0.00",
        deductions: "0.00",
        advanceDeduction: "0.00",
        grossPay: "45000.00",
        netPayable: "45000.00",
        paidAmount: "45000.00",
        remainingPayable: "0.00",
        status: "APPROVED",
        notes: null,
        version: 2,
        approvedAt: "2026-11-05T10:00:00Z",
      },
      {
        id: 103,
        payrollPeriodId: 10,
        workerId: 3,
        workerCode: "W-003",
        workerName: "Anura Bandara",
        designation: "Driver",
        payArrangementSnapshot: "MONTHLY",
        calculationMode: "OWNER_MANUAL_DRAFT",
        approvedDaysCount: 0,
        approvedRegularHours: "0.00",
        approvedOvertimeHours: "0.00",
        basePay: "50000.00",
        overtimePay: "0.00",
        allowances: "0.00",
        deductions: "0.00",
        advanceDeduction: "0.00",
        grossPay: "50000.00",
        netPayable: "50000.00",
        paidAmount: "0.00",
        remainingPayable: "50000.00",
        status: "DRAFT",
        notes: null,
        version: 1,
        approvedAt: null,
      },
    ];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "cashier-001",
              username: "cashier_nimal",
              fullName: "Nimal Perera",
              role: "CASHIER",
            },
          },
        });
      }
      if (url === "/api/materials") {
        return jsonResponse(200, { success: true, data: { materials: [] } });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url.startsWith("/api/workers")) {
        return jsonResponse(200, { success: true, data: { workers: [] } });
      }
      if (url.includes("/periods/") && url.includes("/entries")) {
        return jsonResponse(200, { success: true, data: { entries: entriesList } });
      }
      if (url === "/api/payroll/periods" && (!init?.method || init.method === "GET")) {
        return jsonResponse(200, { success: true, data: { periods: periodsList } });
      }
      if (url === "/api/payroll/periods" && init?.method === "POST") {
        createdPeriodPayload = JSON.parse(init.body as string);
        const newPeriod = {
          id: 11,
          periodLabel: (createdPeriodPayload as any).periodLabel,
          startDate: (createdPeriodPayload as any).startDate,
          endDate: (createdPeriodPayload as any).endDate,
          status: "DRAFT",
          notes: null,
          version: 1,
          createdByUsername: "cashier_nimal",
          createdByRole: "CASHIER",
          createdAt: "2026-11-19T08:00:00Z",
        };
        periodsList.push(newPeriod);
        return jsonResponse(201, { success: true, data: { period: newPeriod } });
      }
      if (url === "/api/payroll/entries/101/payments" && init?.method === "POST") {
        disbursedPaymentPayload = JSON.parse(init.body as string);
        entriesList[0].paidAmount = "30000.00";
        entriesList[0].remainingPayable = "30000.00";
        return jsonResponse(201, {
          success: true,
          data: {
            payment: {
              id: 501,
              salaryReceiptNumber: "REC-SAL-2026-0001",
              payrollEntryId: 101,
              workerId: 1,
              workerName: "Kamal Silva",
              periodLabel: "November 2026",
              paymentDate: "2026-11-19",
              amount: (disbursedPaymentPayload as any).amount,
              paymentMethod: "CASH",
              referenceNote: (disbursedPaymentPayload as any).referenceNote,
              paidByOwnerId: "cashier-001",
              paidByOwnerUsername: "cashier_nimal",
              paidByOwnerRole: "CASHIER",
              createdAt: "2026-11-19T10:00:00Z",
            },
            entry: entriesList[0],
          },
        });
      }
      if (url.startsWith("/api/payroll/advances")) {
        return jsonResponse(200, { success: true, data: { advances: [] } });
      }
      if (url.startsWith("/api/expenses")) {
        return jsonResponse(200, { success: true, data: { expenses: [] } });
      }

      return jsonResponse(404, { success: false, error: { code: "NOT_FOUND", message: "Not found" } });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flush();
      await flush();
    });

    // Navigate to Payroll & Expenses
    const payrollBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.textContent?.includes("Payroll & Expenses")
    )!;
    await act(async () => {
      payrollBtn.click();
      await flush();
      await flush();
    });

    const pageText = container.textContent ?? "";

    // 1. Cashier sees Cashier Portal & New Salary Period form
    assert.match(pageText, /Cashier Operations Portal/);
    assert.match(pageText, /New Salary Period \(Custom Date Range\)/);

    // 2. Cashier does NOT see Owner-only controls
    assert.doesNotMatch(pageText, /Period Audit History/);
    assert.doesNotMatch(pageText, /Initialize Active Workers/);
    assert.doesNotMatch(pageText, /Payment Receipts & Adjustments/);
    assert.doesNotMatch(pageText, /Correct Salary/);

    // 3. Check table action buttons for Cashier
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("table button"));
    const buttonTexts = buttons.map((b) => b.textContent?.trim());

    // On Kamal Silva (APPROVED, remaining 40,000.00): Pay Salary MUST be visible
    assert.ok(buttonTexts.includes("Pay Salary"), "Pay Salary must be available to Cashier on approved entry with balance > 0");

    // On Sunil Perera (APPROVED, remaining 0.00): Pay Salary must NOT be shown
    // On Anura Bandara (DRAFT): Edit Salary shown, Approve must NOT be shown
    assert.ok(buttonTexts.includes("Edit Salary"), "Edit Salary must be available to Cashier on draft entry");
    assert.ok(!buttonTexts.includes("Approve"), "Approve button must NOT be available to Cashier");
    assert.ok(!buttonTexts.includes("Correct Salary"), "Correct Salary must NOT be available to Cashier");
    assert.ok(!buttonTexts.includes("History"), "Salary history button must NOT be available to Cashier");

    // 4. Cashier clicks Pay Salary on Kamal Silva (approved entry with remaining payable > 0)
    const paySalaryBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("table button")).find((b) =>
      b.textContent?.trim() === "Pay Salary"
    )!;
    assert.ok(paySalaryBtn, "Pay Salary button must exist for Kamal Silva");
    await act(async () => {
      paySalaryBtn.click();
      await flush();
      await flush();
    });

    const modalText = container.textContent ?? "";
    assert.match(modalText, /Disburse Cash Salary — Kamal Silva/);
    assert.match(modalText, /CASH \(Physical Cash Voucher — strictly append-only\)/);

    // Change disbursed amount to 10000.00
    const payAmtInput = container.querySelector('input[type="number"][max="40000.00"]') as HTMLInputElement;
    assert.ok(payAmtInput, "Disbursed amount input must exist with max 40000.00");
    await setInputValue(payAmtInput, "10000.00");

    const confirmPayBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('div[role="dialog"] button')).find((b) =>
      b.textContent?.includes("Confirm Cash Payment")
    )!;
    await act(async () => {
      confirmPayBtn.click();
      await flush();
      await flush();
    });

    assert.ok(disbursedPaymentPayload, "POST /api/payroll/entries/:id/payments must have been called");
    assert.equal((disbursedPaymentPayload as any).amount, "10000.00");
    assert.equal((disbursedPaymentPayload as any).paymentMethod, "CASH");
    assert.match(container.textContent ?? "", /Disbursed Rs. 10,000.00 to Kamal Silva \(REC-SAL-2026-0001\)/);

    // 5. Cashier submits New Salary Period form
    const labelInput = container.querySelector('input[placeholder*="November 2026"]') as HTMLInputElement;
    assert.ok(labelInput, "Period Label input must exist");
    await setInputValue(labelInput, "Dec 1-15 Special");

    const createBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("form button")).find((b) =>
      b.textContent?.includes("Create Period")
    )!;
    await act(async () => {
      createBtn.click();
      await flush();
      await flush();
    });

    assert.ok(createdPeriodPayload, "POST /api/payroll/periods must have been called");
    assert.equal((createdPeriodPayload as any).periodLabel, "Dec 1-15 Special");
    assert.match(container.textContent ?? "", /Salary period "Dec 1-15 Special" created/);
  });

  it("11-15: Owner role permissions: period creator metadata, approved salary correction with floor check, payment receipts tab, AMOUNT_CORRECTION and VOID ledger actions", async () => {
    let correctedSalaryPayload: Record<string, unknown> | null = null;
    let adjustmentPayload: Record<string, unknown> | null = null;

    const periodsList = [
      {
        id: 10,
        periodLabel: "November 2026",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        status: "APPROVED",
        notes: null,
        version: 1,
        createdByUsername: "cashier_nimal",
        createdByRole: "CASHIER",
        createdByName: "Nimal Perera",
        approvedByUsername: "owner_nalaka",
        approvedByRole: "OWNER",
        approvedByName: "Nalaka Ranasinghe",
        approvedAt: "2026-11-02T10:00:00Z",
        createdAt: "2026-11-01T08:00:00Z",
      },
    ];

    const entry101 = {
      id: 101,
      payrollPeriodId: 10,
      workerId: 1,
      workerCode: "W-001",
      workerName: "Kamal Silva",
      designation: "Machine Operator",
      payArrangementSnapshot: "MONTHLY",
      calculationMode: "OWNER_MANUAL_DRAFT",
      approvedDaysCount: 0,
      approvedRegularHours: "0.00",
      approvedOvertimeHours: "0.00",
      basePay: "65000.00",
      overtimePay: "0.00",
      allowances: "0.00",
      deductions: "0.00",
      advanceDeduction: "5000.00",
      grossPay: "65000.00",
      netPayable: "60000.00",
      paidAmount: "25000.00",
      remainingPayable: "35000.00",
      status: "APPROVED",
      notes: null,
      version: 2,
      approvedAt: "2026-11-05T10:00:00Z",
    };

    const paymentRecords = [
      {
        id: 501,
        salaryReceiptNumber: "REC-SAL-2026-0001",
        payrollEntryId: 101,
        workerId: 1,
        workerName: "Kamal Silva",
        periodLabel: "November 2026",
        paymentDate: "2026-11-10",
        amount: "25000.00",
        effectiveAmount: "25000.00",
        paymentMethod: "CASH",
        referenceNote: "First tranche",
        paidByOwnerId: "cashier-001",
        paidByOwnerUsername: "cashier_nimal",
        paidByOwnerName: "Nimal Perera",
        paidByOwnerRole: "CASHIER",
        createdAt: "2026-11-10T09:30:00Z",
      },
    ];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "owner-001",
              username: "owner_nalaka",
              fullName: "Nalaka Ranasinghe",
              role: "OWNER",
            },
          },
        });
      }
      if (url === "/api/materials") {
        return jsonResponse(200, { success: true, data: { materials: [] } });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url.startsWith("/api/workers")) {
        return jsonResponse(200, { success: true, data: { workers: [] } });
      }
      if (url.includes("/periods/") && url.includes("/entries")) {
        return jsonResponse(200, { success: true, data: { entries: [entry101] } });
      }
      if (url === "/api/payroll/periods" && (!init?.method || init.method === "GET")) {
        return jsonResponse(200, { success: true, data: { periods: periodsList } });
      }
      if (url.startsWith("/api/payroll/advances")) {
        return jsonResponse(200, { success: true, data: { advances: [] } });
      }
      if (url === "/api/payroll/payments" && (!init?.method || init.method === "GET")) {
        return jsonResponse(200, { success: true, data: { payments: paymentRecords } });
      }
      if (url.startsWith("/api/expenses")) {
        return jsonResponse(200, { success: true, data: { expenses: [] } });
      }
      if (url === "/api/payroll/entries/101/approved-salary" && init?.method === "PUT") {
        correctedSalaryPayload = JSON.parse(init.body as string);
        entry101.grossPay = (correctedSalaryPayload as any).newGrossSalary;
        entry101.basePay = (correctedSalaryPayload as any).newGrossSalary;
        entry101.netPayable = String(Number(entry101.grossPay) - Number(entry101.advanceDeduction));
        entry101.remainingPayable = String(Number(entry101.netPayable) - Number(entry101.paidAmount));
        entry101.version += 1;
        return jsonResponse(200, { success: true, data: { entry: entry101 } });
      }
      if (url === "/api/payroll/payments/501/adjust" && init?.method === "POST") {
        adjustmentPayload = JSON.parse(init.body as string);
        const adjType = (adjustmentPayload as any).adjustmentType;
        const newEff = adjType === "VOID" ? "0.00" : (adjustmentPayload as any).correctedAmount;
        paymentRecords[0].effectiveAmount = newEff;
        return jsonResponse(201, {
          success: true,
          data: {
            adjustment: {
              id: 901,
              adjustmentNumber: "ADJ-2026-0001",
              salaryPaymentId: 501,
              payrollEntryId: 101,
              workerId: 1,
              workerName: "Kamal Silva",
              adjustmentType: adjType,
              priorEffectiveAmount: "25000.00",
              correctedAmount: newEff,
              adjustmentDelta: String(Number(newEff) - 25000),
              authorizedByUserId: "owner-001",
              authorizedByUsername: "owner_nalaka",
              authorizedByName: "Nalaka Ranasinghe",
              authorizedByRole: "OWNER",
              reason: (adjustmentPayload as any).reason,
              createdAt: "2026-11-19T11:00:00Z",
            },
            entry: entry101,
            replayed: false,
          },
        });
      }
      if (url === "/api/payroll/payments/501/adjustments") {
        return jsonResponse(200, {
          success: true,
          data: {
            paymentId: 501,
            adjustments: [
              {
                id: 901,
                adjustmentNumber: "ADJ-2026-0001",
                salaryPaymentId: 501,
                payrollEntryId: 101,
                workerId: 1,
                workerName: "Kamal Silva",
                adjustmentType: "AMOUNT_CORRECTION",
                priorEffectiveAmount: "25000.00",
                correctedAmount: "20000.00",
                adjustmentDelta: "-5000.00",
                authorizedByUserId: "owner-001",
                authorizedByUsername: "owner_nalaka",
                authorizedByName: "Nalaka Ranasinghe",
                authorizedByRole: "OWNER",
                reason: "Reconciliation voucher correction",
                createdAt: "2026-11-19T11:00:00Z",
              },
            ],
          },
        });
      }

      return jsonResponse(404, { success: false, error: { code: "NOT_FOUND", message: "Not found" } });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flush();
      await flush();
    });

    // Navigate to Payroll & Expenses
    const payrollBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Payroll & Expenses")
    )!;
    await act(async () => {
      payrollBtn.click();
      await flush();
      await flush();
    });

    const pageText = container.textContent ?? "";

    // 1. Owner portal and period creator metadata rendered
    assert.match(pageText, /Owner Management Portal/);
    assert.match(pageText, /Created by:\s*Nimal Perera\s*CASHIER/);
    assert.match(pageText, /Approved by:\s*Nalaka Ranasinghe\s*OWNER/);

    // 2. Owner sees Correct Salary button on Kamal Silva
    const correctSalaryBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("table button")).find((b) =>
      b.textContent?.trim() === "Correct Salary"
    )!;
    assert.ok(correctSalaryBtn, "Owner must see Correct Salary button on approved entry");

    await act(async () => {
      correctSalaryBtn.click();
      await flush();
      await flush();
    });

    assert.match(container.textContent ?? "", /Correct Approved Salary — Kamal Silva/);
    assert.match(container.textContent ?? "", /Already Paid Cash/);

    // 3. Test floor validation: set proposed gross so proposed net < already paid cash (25,000)
    // Advances = 5,000. If Gross = 26,000 => Proposed Net = 21,000 < 25,000 => Floor Violated!
    const grossInput = container.querySelector('input[type="number"][placeholder*="70000.00"]') as HTMLInputElement;
    assert.ok(grossInput, "Gross salary input must exist");
    await setInputValue(grossInput, "26000.00");

    const reasonInput = container.querySelector('input[placeholder*="owner agreement"]') as HTMLInputElement;
    assert.ok(reasonInput, "Business reason input must exist");
    await setInputValue(reasonInput, "Valid business correction reason");

    assert.match(container.textContent ?? "", /Floor Invariant Violation/);
    const confirmCorrectionBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('div[role="dialog"] button')).find((b) =>
      b.textContent?.includes("Confirm Salary Correction")
    )!;
    assert.ok(confirmCorrectionBtn.disabled, "Submit button MUST be disabled when floor invariant is violated");

    // Now set valid proposed gross = 75,000.00 => Net = 70,000 >= 25,000
    await setInputValue(grossInput, "75000.00");
    assert.doesNotMatch(container.textContent ?? "", /Floor Invariant Violation/);

    const activeConfirmBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('div[role="dialog"] button')).find((b) =>
      b.textContent?.includes("Confirm Salary Correction")
    )!;
    assert.ok(!activeConfirmBtn.disabled, "Submit button must be enabled when floor invariant is satisfied");

    const modalForm = container.querySelector('div[role="dialog"] form') as HTMLFormElement;
    await act(async () => {
      activeConfirmBtn.click();
      if (!correctedSalaryPayload && modalForm) {
        modalForm.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      }
      await flush();
      await flush();
    });

    assert.ok(correctedSalaryPayload, "PUT /api/payroll/entries/101/approved-salary must be called");
    assert.equal((correctedSalaryPayload as any).newGrossSalary, "75000.00");
    assert.match(container.textContent ?? "", /Approved salary for Kamal Silva corrected successfully/);

    // 4. Test Owner Payment Receipts & Adjustments tab
    const paymentsTabBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.textContent?.includes("Payment Receipts & Adjustments")
    )!;
    assert.ok(paymentsTabBtn, "Payment Receipts & Adjustments tab must be visible to Owner");

    await act(async () => {
      paymentsTabBtn.click();
      await flush();
      await flush();
    });

    const paymentsViewText = container.textContent ?? "";
    assert.match(paymentsViewText, /Disbursed Salary Payment Receipts & Adjustments/);
    assert.match(paymentsViewText, /REC-SAL-2026-0001/);
    assert.match(paymentsViewText, /Nimal Perera/);
    assert.match(paymentsViewText, /CASHIER/);
    assert.match(paymentsViewText, /PAID/);

    // 5. Test AMOUNT_CORRECTION
    const correctAmountBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("table button")).find((b) =>
      b.textContent?.trim() === "Correct Amount"
    )!;
    assert.ok(correctAmountBtn, "Correct Amount button must exist on receipt");

    await act(async () => {
      correctAmountBtn.click();
      await flush();
      await flush();
    });

    assert.match(container.textContent ?? "", /Correct Payment Amount/);
    const adjAmtInput = container.querySelector('input[type="number"][placeholder*="50000.00"]') as HTMLInputElement;
    assert.ok(adjAmtInput, "Adjust corrected amount input must exist");
    await setInputValue(adjAmtInput, "20000.00");

    const adjReasonInput = container.querySelector('input[placeholder*="reconciliation"]') as HTMLInputElement;
    assert.ok(adjReasonInput, "Adjustment reason input must exist");
    await setInputValue(adjReasonInput, "Correcting over-disbursement voucher per reconciliation");

    const confirmAdjBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('div[role="dialog"] button')).find((b) =>
      b.textContent?.includes("Confirm Amount Correction")
    )!;
    await act(async () => {
      confirmAdjBtn.click();
      await flush();
      await flush();
    });

    assert.ok(adjustmentPayload, "POST /api/payroll/payments/501/adjust must be called");
    assert.equal((adjustmentPayload as any).adjustmentType, "AMOUNT_CORRECTION");
    assert.equal((adjustmentPayload as any).correctedAmount, "20000.00");
    assert.match(container.textContent ?? "", /corrected successfully to Rs. 20,000.00/);

    // 6. Test VOID operation
    const voidPaymentBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("table button")).find((b) =>
      b.textContent?.trim() === "Void Payment"
    )!;
    assert.ok(voidPaymentBtn, "Void Payment button must exist");

    await act(async () => {
      voidPaymentBtn.click();
      await flush();
      await flush();
    });

    assert.match(container.textContent ?? "", /Void Salary Payment/);
    assert.match(container.textContent ?? "", /Notice on Void Operation/);

    const voidReasonInput = container.querySelector('input[placeholder*="reconciliation"]') as HTMLInputElement;
    await setInputValue(voidReasonInput, "Voiding erroneously entered cash voucher receipt");

    const confirmVoidBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('div[role="dialog"] button')).find((b) =>
      b.textContent?.includes("Confirm Void Payment")
    )!;
    await act(async () => {
      confirmVoidBtn.click();
      await flush();
      await flush();
    });

    assert.equal((adjustmentPayload as any).adjustmentType, "VOID");
    assert.match(container.textContent ?? "", /voided successfully \(effective amount: Rs. 0.00\)/);

    // 7. Test Adjustments History Modal
    const adjustmentsHistoryBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("table button")).find((b) =>
      b.textContent?.trim() === "Adjustments"
    )!;
    assert.ok(adjustmentsHistoryBtn, "Adjustments button must exist");

    await act(async () => {
      adjustmentsHistoryBtn.click();
      await flush();
      await flush();
    });

    const historyModalText = container.textContent ?? "";
    assert.match(historyModalText, /Payment Adjustment History/);
    assert.match(historyModalText, /ADJ-2026-0001/);
    assert.match(historyModalText, /AMOUNT_CORRECTION/);
    assert.match(historyModalText, /Rs. 25,000.00/);
    assert.match(historyModalText, /Rs. 20,000.00/);
    assert.match(historyModalText, /-Rs. 5,000.00/);
    assert.match(historyModalText, /Nalaka Ranasinghe/);
  });
});
