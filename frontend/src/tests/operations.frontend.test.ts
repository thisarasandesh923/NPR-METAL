import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testDom } from "./domSetup.ts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../App.tsx";
import { canAccessScreen, resolveAuthorizedScreen } from "../features/auth/authNavigation.ts";
import { previewIntervalNetHours } from "../features/operations/spreadsheetUtils.ts";
import type { InvoiceDetail, MaterialCatalogItem } from "../types/billing.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
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

describe("Phase 5-6 Operations, Approvals, Price Management, Payroll & Payment Reversal — Frontend Tests", () => {
  let container: HTMLElement;
  let root: Root | null = null;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    testDom.window.document.body.innerHTML = "<div id='root'></div>";
    container = testDom.window.document.getElementById("root")!;
    originalFetch = globalThis.fetch;
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

  it("computes spreadsheet net hour previews accurately and enforces strict RBAC route blocking", () => {
    assert.equal(previewIntervalNetHours("08:00", "17:00", false, 60), "8.00");
    assert.equal(previewIntervalNetHours("22:00", "06:00", true, 30), "7.50");
    assert.equal(previewIntervalNetHours("17:00", "08:00", false, 0), null);
    assert.equal(previewIntervalNetHours("08:00", "09:00", false, 90), null);

    assert.equal(canAccessScreen("CASHIER", "daily-operations"), true);
    assert.equal(canAccessScreen("CASHIER", "payroll"), false);
    assert.equal(canAccessScreen("CASHIER", "material-prices"), false);
    assert.equal(canAccessScreen("CASHIER", "approvals"), false);
    assert.equal(canAccessScreen("CASHIER", "workers-machines"), false);
    assert.equal(resolveAuthorizedScreen("CASHIER", "payroll"), "cashier-dashboard");
    assert.equal(canAccessScreen("OWNER", "payroll"), true);
  });

  it("blocks Cashier from Owner navigation links and allows Cashier spreadsheet Draft -> Submit", async () => {
    const attendanceRows: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "c-ops",
              username: "cashier_ops",
              fullName: "Nimal Jayawardena",
              role: "CASHIER",
            },
          },
        });
      }
      if (url === "/api/materials") {
        return jsonResponse(200, {
          success: true,
          data: {
            materials: [
              { id: 1, code: "3/4", name: '3/4"', unit: "m³", currentUnitPrice: "12000.00", isActive: true },
            ],
          },
        });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url.startsWith("/api/workers")) {
        return jsonResponse(200, {
          success: true,
          data: {
            workers: [
              {
                id: 10,
                workerCode: "WRK-01",
                fullName: "Kamal Silva",
                phone: null,
                designation: "Operator",
                joinedDate: null,
                employmentStatus: "ACTIVE",
                notes: null,
                createdAt: "2026-11-01T00:00:00Z",
              },
            ],
          },
        });
      }
      if (url.startsWith("/api/machines")) {
        return jsonResponse(200, { success: true, data: { machines: [] } });
      }
      if (url.startsWith("/api/attendance?") && (!init?.method || init.method === "GET")) {
        return jsonResponse(200, { success: true, data: { attendance: attendanceRows } });
      }
      if (url === "/api/attendance" && init?.method === "POST") {
        const created = {
          id: 501,
          workDate: "2026-11-12",
          workerId: 10,
          workerCode: "WRK-01",
          workerName: "Kamal Silva",
          startTime: "08:00",
          endTime: "17:00",
          crossesMidnight: false,
          breakMinutes: 60,
          hoursWorked: "8.00",
          overtimeHours: "0.00",
          remarks: null,
          enteredByUserId: "c-ops",
          enteredByName: "Nimal Jayawardena",
          approvalStatus: "DRAFT",
          version: 1,
          submittedAt: null,
          reviewedByOwnerId: null,
          reviewedByName: null,
          reviewedAt: null,
          reviewReason: null,
          updatedAt: "2026-11-12T08:00:00Z",
        };
        attendanceRows.push(created);
        return jsonResponse(201, { success: true, data: { attendance: created } });
      }
      if (url === "/api/attendance/501/submit" && init?.method === "POST") {
        attendanceRows[0].approvalStatus = "SUBMITTED";
        attendanceRows[0].version = 2;
        return jsonResponse(200, { success: true, data: { attendance: attendanceRows[0] } });
      }
      if (url.startsWith("/api/machine-logs")) {
        return jsonResponse(200, { success: true, data: { machineLogs: [] } });
      }
      if (url.startsWith("/api/production")) {
        return jsonResponse(200, { success: true, data: { productionLogs: [] } });
      }
      return jsonResponse(404, { success: false, error: { code: "NOT_FOUND", message: "Not found" } });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flush();
      await flush();
    });

    const sidebarText = container.textContent ?? "";
    assert.doesNotMatch(sidebarText, /Payroll & Expenses/);
    assert.doesNotMatch(sidebarText, /Price Management/);
    assert.doesNotMatch(sidebarText, /Approvals Queue/);

    const opsBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Daily Operations")
    )!;
    await act(async () => {
      opsBtn.click();
      await flush();
      await flush();
    });

    assert.match(container.textContent ?? "", /Daily Workshop Logs/);

    const addRowBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("+ Add Row")
    )!;
    await act(async () => {
      addRowBtn.click();
      await flush();
    });

    const submitRowBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Submit"
    )!;
    await act(async () => {
      submitRowBtn.click();
      await flush();
      await flush();
    });

    assert.match(
      container.textContent ?? "",
      /submitted for Owner approval|Pending Approval/
    );
  });

  it("allows Owner to update Material Prices, approve pending queues, inspect Reports, and reverse erroneous payment entry", async () => {
    const materials: MaterialCatalogItem[] = [
      { id: 1, code: "3/4", name: '3/4"', unit: "m³", currentUnitPrice: "12000.00", isActive: true, version: 1 },
    ];
    const invoiceDetail: InvoiceDetail = {
      id: 77,
      invoiceNumber: "NPR-INV-000077",
      customerId: 5,
      customerName: "Saman Hardware",
      customerPhone: "0771234567",
      customerLocation: "Kurunegala",
      hasTransport: false,
      transportFee: "0.00",
      subtotal: "24000.00",
      grandTotal: "24000.00",
      effectiveGrandTotal: "24000.00",
      paidAmount: "10000.00",
      balanceDue: "14000.00",
      paymentStatus: "PARTIALLY_PAID",
      invoiceStatus: "ISSUED",
      issuedByUserId: "c-1",
      issuedByName: "Cashier",
      issuedAt: "2026-11-12T08:00:00Z",
      businessDate: "2026-11-12",
      items: [
        { id: 1, materialId: 1, materialName: '3/4"', quantity: "2.000", unitPrice: "12000.00", lineTotal: "24000.00" },
      ],
      payments: [
        {
          id: 90,
          receiptNumber: "NPR-RCP-000090",
          invoiceId: 77,
          cashierUserId: "c-1",
          cashierName: "Cashier",
          amount: "10000.00",
          paymentMethod: "CASH",
          notes: "Initial",
          createdAt: "2026-11-12T08:00:00Z",
        },
      ],
      adjustments: [],
    };
    let priceReasonCaptured = "";
    let reversalCaptured = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "o-1",
              username: "owner",
              fullName: "Rohan Wijeratne",
              role: "OWNER",
            },
          },
        });
      }
      if (url === "/api/reports/overview") {
        return jsonResponse(200, {
          success: true,
          data: {
            overview: {
              businessDate: "2026-11-12",
              todayInvoiceCount: 1,
              todayBilledTotal: "24000.00",
              todayCashCollected: "10000.00",
              todayReceiptCount: 1,
              totalOutstandingBalance: "14000.00",
              openInvoicesCount: 1,
              totalIssuedInvoicesCount: 1,
            },
          },
        });
      }
      if (url.startsWith("/api/reports/financial")) {
        return jsonResponse(200, {
          success: true,
          data: {
            financial: {
              dateFrom: "2026-11-01",
              dateTo: "2026-11-12",
              billedSalesTotal: "24000.00",
              issuedInvoiceCount: 1,
              cashCollectedTotal: "10000.00",
              receiptCount: 1,
              outstandingReceivablesTotal: "14000.00",
              openInvoicesCount: 1,
              recordedExpensesTotal: "5000.00",
              payrollApprovedLiabilityTotal: "0.00",
              payrollCashPaidTotal: "0.00",
              dailySales: [],
              cashierCollections: [],
              expensesBreakdown: [{ category: "FUEL", totalAmount: "5000.00", entryCount: 1 }],
            },
          },
        });
      }
      if (url.startsWith("/api/reports/operations")) {
        return jsonResponse(200, {
          success: true,
          data: {
            operations: {
              dateFrom: "2026-11-01",
              dateTo: "2026-11-12",
              approvedAttendanceDays: 2,
              approvedWorkerHours: "16.00",
              approvedOvertimeHours: "1.00",
              approvedMachineHours: "14.00",
              approvedMachineDowntimeMinutes: 30,
              approvedProductionTotalM3: "55.500",
              pendingApprovalCounts: { attendance: 1, machineLogs: 0, productionLogs: 0 },
              productionByMaterial: [],
              productionByMachine: [],
              machineSummary: [],
            },
          },
        });
      }
      if (url.startsWith("/api/invoices?")) {
        return jsonResponse(200, { success: true, data: { invoices: [invoiceDetail] } });
      }
      if (url === "/api/invoices/77") {
        return jsonResponse(200, { success: true, data: { invoice: invoiceDetail } });
      }
      if (url === "/api/payments/90/adjust" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { amount: string; reason: string };
        reversalCaptured = body.reason;
        invoiceDetail.paidAmount = "7500.00";
        invoiceDetail.balanceDue = "16500.00";
        invoiceDetail.adjustments = [
          {
            id: 1,
            adjustmentNumber: "NPR-ADJ-000001",
            paymentId: 90,
            receiptNumber: "NPR-RCP-000090",
            adjustmentType: "ENTRY_REVERSAL",
            adjustmentAmount: body.amount,
            reason: body.reason,
            authorizedByOwnerId: "o-1",
            authorizedByOwnerName: "Rohan Wijeratne",
            createdAt: "2026-11-12T09:00:00Z",
          },
        ];
        return jsonResponse(201, { success: true, data: { invoice: invoiceDetail } });
      }
      if (url === "/api/materials") {
        return jsonResponse(200, { success: true, data: { materials } });
      }
      if (url.startsWith("/api/materials/price-history")) {
        return jsonResponse(200, { success: true, data: { history: [] } });
      }
      if (url === "/api/materials/1/price" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { newPrice: string; reason: string };
        priceReasonCaptured = body.reason;
        materials[0] = { ...materials[0], currentUnitPrice: body.newPrice, version: 2 };
        return jsonResponse(200, { success: true, data: { material: materials[0] } });
      }
      return jsonResponse(404, { success: false, error: { code: "NOT_FOUND", message: "Not found" } });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flush();
      await flush();
    });

    // Check Pending Approvals pill rendered on OwnerDashboard
    assert.match(container.textContent ?? "", /Pending Approvals: 1/);

    // Open invoice detail & perform Owner ENTRY_REVERSAL
    const inspectBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Inspect / Print")
    )!;
    await act(async () => {
      inspectBtn.click();
      await flush();
      await flush();
    });

    const revBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Reverse Entry")
    )!;
    await act(async () => {
      revBtn.click();
      await flush();
    });

    const revReasonInput = container.querySelector("textarea")!;
    const revAmtInput = container.querySelector("input[type='number']") as HTMLInputElement;
    await setInputValue(revAmtInput, "2500.00");
    await setInputValue(revReasonInput, "Clerical mistype Rs 10000 instead of Rs 7500.");
    const revSubmit = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Confirm Entry Reversal")
    )!;
    await act(async () => {
      revSubmit.click();
      await flush();
      await flush();
    });

    assert.equal(reversalCaptured, "Clerical mistype Rs 10000 instead of Rs 7500.");
    assert.match(container.textContent ?? "", /NPR-ADJ-000001/);

    // Navigate to Price Management and update selling price
    const priceNav = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Price Management")
    )!;
    await act(async () => {
      priceNav.click();
      await flush();
      await flush();
    });

    const editPriceBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Update Price")
    )!;
    await act(async () => {
      editPriceBtn.click();
      await flush();
    });

    const priceInput = container.querySelector("#price-input") as HTMLInputElement;
    const priceReason = container.querySelector("#price-reason") as HTMLTextAreaElement;
    await setInputValue(priceInput, "13500.00");
    await setInputValue(priceReason, "Diesel fuel cost adjustment");

    const savePriceBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Save Price Update")
    )!;
    await act(async () => {
      savePriceBtn.click();
      await flush();
      await flush();
    });

    assert.equal(priceReasonCaptured, "Diesel fuel cost adjustment");
    assert.match(container.textContent ?? "", /Rs\. 13,500\.00/);
  });
});

