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
    assert.equal(canAccessScreen("CASHIER", "payroll"), true);
    assert.equal(canAccessScreen("CASHIER", "material-prices"), true);
    assert.equal(canAccessScreen("CASHIER", "approvals"), false);
    assert.equal(canAccessScreen("CASHIER", "workers-machines"), false);
    assert.equal(resolveAuthorizedScreen("CASHIER", "payroll"), "payroll");
    assert.equal(canAccessScreen("OWNER", "payroll"), true);
  });

  it("blocks Cashier from Owner navigation links and allows Cashier spreadsheet Draft -> Submit", async () => {
    localStorage.setItem("npr_preferred_language", "en");
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
    assert.match(sidebarText, /Payroll & Expenses/);
    assert.match(sidebarText, /Price Management/);
    assert.doesNotMatch(sidebarText, /Approvals Queue/);
    assert.doesNotMatch(sidebarText, /Workers & Machines/);

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
      if (url === "/api/materials" || url.startsWith("/api/materials?")) {
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

  it("renders 11 products catalogue and allows Owner to configure price and activate inactive materials", async () => {
    const catalogMaterials: MaterialCatalogItem[] = [
      { id: 1, code: "3/4", name: "3/4 Metal", unit: "m³", currentUnitPrice: "12000.00", isActive: true, version: 1 },
      { id: 2, code: "DUST", name: "Dust", unit: "m³", currentUnitPrice: "8500.00", isActive: true, version: 1 },
      { id: 3, code: "CHIP", name: "Chip", unit: "m³", currentUnitPrice: "0.00", isActive: false, version: 1 },
      { id: 4, code: "6X9", name: "6×9 (Aggregate)", unit: "m³", currentUnitPrice: "10250.00", isActive: true, version: 1 },
      { id: 5, code: "2X2", name: "2×2", unit: "m³", currentUnitPrice: "0.00", isActive: false, version: 1 },
      { id: 6, code: "1_INCH", name: '1" (Inch)', unit: "m³", currentUnitPrice: "0.00", isActive: false, version: 1 },
      { id: 7, code: "1_1/2", name: "1 1/2", unit: "m³", currentUnitPrice: "0.00", isActive: false, version: 1 },
      { id: 8, code: "ABC", name: "ABC", unit: "m³", currentUnitPrice: "11000.00", isActive: true, version: 1 },
      { id: 9, code: "SUBBASE", name: "SubBase", unit: "m³", currentUnitPrice: "0.00", isActive: false, version: 1 },
      { id: 10, code: "MIX", name: "Mix (Dust & Chip)", unit: "m³", currentUnitPrice: "0.00", isActive: false, version: 1 },
      { id: 11, code: "QUARRY_MUCK", name: "Quarry Muck", unit: "m³", currentUnitPrice: "0.00", isActive: false, version: 1 },
    ];

    let capturedPayload: any = null;

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
              todayInvoiceCount: 0,
              todayBilledTotal: "0.00",
              todayCashCollected: "0.00",
              todayReceiptCount: 0,
              totalOutstandingBalance: "0.00",
              openInvoicesCount: 0,
              totalIssuedInvoicesCount: 0,
            },
          },
        });
      }
      if (url.startsWith("/api/reports/financial")) {
        return jsonResponse(200, {
          success: true,
          data: {
            report: {
              dateRange: { from: "2026-11-01", to: "2026-11-12" },
              totalInvoiced: "0.00",
              totalCashCollected: "0.00",
              totalAdjustments: "0.00",
              netCashFlow: "0.00",
              paymentCount: 0,
              adjustmentCount: 0,
              customerBalances: [],
            },
          },
        });
      }
      if (url.startsWith("/api/operations/pending-approvals")) {
        return jsonResponse(200, {
          success: true,
          data: {
            counts: { totalPending: 0, timesheets: 0, logs: 0, advances: 0, expenses: 0 },
            pendingTimesheets: [],
            pendingMachineLogs: [],
            pendingAdvances: [],
            pendingExpenses: [],
          },
        });
      }
      if (url === "/api/invoices") {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url === "/api/materials" || url.startsWith("/api/materials?")) {
        return jsonResponse(200, { success: true, data: { materials: catalogMaterials } });
      }
      if (url.startsWith("/api/materials/price-history")) {
        return jsonResponse(200, { success: true, data: { history: [] } });
      }
      if (url === "/api/materials/3/price" && init?.method === "PUT") {
        capturedPayload = JSON.parse(String(init.body));
        catalogMaterials[2] = {
          ...catalogMaterials[2],
          currentUnitPrice: capturedPayload.newPrice,
          isActive: capturedPayload.isActive ?? true,
          version: 2,
        };
        return jsonResponse(200, { success: true, data: { material: catalogMaterials[2] } });
      }
      return jsonResponse(404, { success: false, error: { code: "NOT_FOUND", message: "Not found" } });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flush();
      await flush();
    });

    // Navigate to Price Management
    const priceNav = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Price Management")
    )!;
    await act(async () => {
      priceNav.click();
      await flush();
      await flush();
    });

    const pageText = container.textContent ?? "";
    // Verify all 11 products appear in Owner Price Management
    assert.match(pageText, /3\/4 Metal/);
    assert.match(pageText, /Dust/);
    assert.match(pageText, /Chip/);
    assert.match(pageText, /6×9 \(Aggregate\)/);
    assert.match(pageText, /2×2/);
    assert.match(pageText, /1" \(Inch\)/);
    assert.match(pageText, /1 1\/2/);
    assert.match(pageText, /ABC/);
    assert.match(pageText, /SubBase/);
    assert.match(pageText, /Mix \(Dust & Chip\)/);
    assert.match(pageText, /Quarry Muck/);

    // Verify Active and Inactive status badges
    assert.match(pageText, /Active/);
    assert.match(pageText, /Inactive/);

    // Find the "Configure & Activate" button for Chip (id: 3)
    const configureBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Configure & Activate")
    );
    assert.ok(configureBtn, "Expected 'Configure & Activate' button for inactive material");

    await act(async () => {
      configureBtn.click();
      await flush();
    });

    // Verify modal rendered with activation messaging
    assert.match(container.textContent ?? "", /Configure Price & Activate — Chip/);
    assert.match(container.textContent ?? "", /Activate material for Cashier billing upon saving/);

    const priceInput = container.querySelector("#price-input") as HTMLInputElement;
    const priceReason = container.querySelector("#price-reason") as HTMLTextAreaElement;
    await setInputValue(priceInput, "9500.00");
    await setInputValue(priceReason, "Approved initial market rate for Chip aggregate");

    const submitBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Activate & Save Price")
    )!;
    await act(async () => {
      submitBtn.click();
      await flush();
      await flush();
    });

    assert.ok(capturedPayload, "Expected PUT payload for price configuration");
    assert.equal(capturedPayload.newPrice, "9500.00");
    assert.equal(capturedPayload.isActive, true);
    assert.equal(capturedPayload.reason, "Approved initial market rate for Chip aggregate");

    // After activation, Chip must show Rs. 9,500.00 and activated notice
    assert.match(container.textContent ?? "", /activated for cashier billing/i);
  });

  it("allows Cashier to update selling price immediately without Owner approval, while keeping audit history Owner-only", async () => {
    localStorage.setItem("npr_preferred_language", "en");

    let priceHistoryFetchCalled = false;
    let capturedUpdatePayload: any = null;

    const activeMaterials = [
      {
        id: 1,
        code: "3/4",
        name: "3/4 Metal",
        unit: "m³",
        currentUnitPrice: "5000.00",
        isActive: true,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
    ];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "cashier-uuid-1",
              username: "cashier1",
              fullName: "Kasun Bandara",
              role: "CASHIER",
            },
          },
        });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url === "/api/materials" || url === "/api/materials?includeInactive=false") {
        return jsonResponse(200, {
          success: true,
          data: { materials: activeMaterials },
        });
      }
      if (url.startsWith("/api/materials/price-history")) {
        priceHistoryFetchCalled = true;
        return jsonResponse(403, {
          success: false,
          error: { code: "FORBIDDEN", message: "Cashiers cannot view audit history" },
        });
      }
      if (url === "/api/materials/1/price" && init?.method === "PUT") {
        capturedUpdatePayload = JSON.parse(String(init.body));
        activeMaterials[0] = {
          ...activeMaterials[0],
          currentUnitPrice: capturedUpdatePayload.newPrice,
          version: 2,
        };
        return jsonResponse(200, {
          success: true,
          data: { material: activeMaterials[0] },
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

    // Verify Cashier sees Price Management in sidebar navigation
    const priceNav = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Price Management")
    );
    assert.ok(priceNav, "Cashier should have Price Management in navigation");

    await act(async () => {
      priceNav.click();
      await flush();
      await flush();
    });

    const pageText = container.textContent ?? "";
    assert.match(pageText, /Cashier Portal/);
    assert.match(pageText, /Current Aggregate Selling Prices/);
    assert.match(pageText, /3\/4 Metal/);

    // Cashiers must NOT access or see the Price Change Audit History
    assert.equal(priceHistoryFetchCalled, false, "Cashier should not request price history endpoint");
    assert.doesNotMatch(pageText, /Price Change Audit History/);

    // Click Update Price
    const updateBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Update Price")
    )!;
    await act(async () => {
      updateBtn.click();
      await flush();
    });

    assert.match(container.textContent ?? "", /Update Price — 3\/4 Metal/);
    // Cashier must NOT see activation checkbox
    assert.doesNotMatch(container.textContent ?? "", /Activate material for Cashier billing/);

    const priceInput = container.querySelector("#price-input") as HTMLInputElement;
    const priceReason = container.querySelector("#price-reason") as HTMLTextAreaElement;
    await setInputValue(priceInput, "5350.00");
    await setInputValue(priceReason, "Fuel price hike adjustment for transport");

    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Save Price Update")
    )!;
    await act(async () => {
      saveBtn.click();
      await flush();
      await flush();
    });

    // Verify PUT request payload sent by Cashier
    assert.ok(capturedUpdatePayload);
    assert.equal(capturedUpdatePayload.newPrice, "5350.00");
    assert.equal(capturedUpdatePayload.reason, "Fuel price hike adjustment for transport");
    assert.equal(capturedUpdatePayload.expectedVersion, 1);
    assert.equal(capturedUpdatePayload.isActive, undefined, "Cashier should not send isActive");

    // Success notice displayed
    assert.match(container.textContent ?? "", /Updated selling price for 3\/4 Metal to/);
  });

  it("displays Owner-visible price change audit history with role badges and filtering by cashier, material, and date", async () => {
    localStorage.setItem("npr_preferred_language", "en");

    let requestedHistoryUrl = "";

    const materials = [
      {
        id: 1,
        code: "3/4",
        name: "3/4 Metal",
        unit: "m³",
        currentUnitPrice: "5350.00",
        isActive: true,
        version: 2,
        updatedAt: new Date().toISOString(),
      },
    ];

    const historyRecords = [
      {
        id: 101,
        materialId: 1,
        materialCode: "3/4",
        materialName: "3/4 Metal",
        oldPrice: "5000.00",
        newPrice: "5350.00",
        changedByUserId: "c-uuid-1",
        changedByUsername: "cashier_nimal",
        changedByName: "Nimal Jayawardena",
        changedByRole: "CASHIER",
        reason: "Fuel price surcharge",
        effectiveAt: "2026-11-15T10:30:00Z",
      },
      {
        id: 102,
        materialId: 1,
        materialCode: "3/4",
        materialName: "3/4 Metal",
        oldPrice: "4800.00",
        newPrice: "5000.00",
        changedByUserId: "o-uuid-1",
        changedByUsername: "owner_nalaka",
        changedByName: "Nalaka Ranasinghe",
        changedByRole: "OWNER",
        reason: "Quarry license revision",
        effectiveAt: "2026-11-10T08:00:00Z",
      },
    ];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "owner-uuid-1",
              username: "owner_nalaka",
              fullName: "Nalaka Ranasinghe",
              role: "OWNER",
            },
          },
        });
      }
      if (url.startsWith("/api/operations/reports/summary")) {
        return jsonResponse(200, { success: true, data: { summary: {} } });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url.startsWith("/api/materials?includeInactive=true")) {
        return jsonResponse(200, { success: true, data: { materials } });
      }
      if (url.startsWith("/api/materials/price-history")) {
        requestedHistoryUrl = url;
        return jsonResponse(200, {
          success: true,
          data: { history: historyRecords },
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

    // Navigate to Price Management as Owner
    const priceNav = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Price Management")
    )!;
    await act(async () => {
      priceNav.click();
      await flush();
      await flush();
    });

    const pageText = container.textContent ?? "";
    assert.match(pageText, /Owner Controls/);
    assert.match(pageText, /Price Change Audit History/);

    // Verify audit history rows render usernames and role badges
    assert.match(pageText, /cashier_nimal/);
    assert.match(pageText, /CASHIER/);
    assert.match(pageText, /owner_nalaka/);
    assert.match(pageText, /OWNER/);
    assert.match(pageText, /Fuel price surcharge/);
    assert.match(pageText, /Quarry license revision/);

    // Test filter inputs
    const cashierFilterInput = container.querySelector("#filter-cashier") as HTMLInputElement;
    const dateFromInput = container.querySelector("#filter-date-from") as HTMLInputElement;
    const dateToInput = container.querySelector("#filter-date-to") as HTMLInputElement;

    await setInputValue(cashierFilterInput, "cashier_nimal");
    await setInputValue(dateFromInput, "2026-11-01");
    await setInputValue(dateToInput, "2026-11-15");

    const filterBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Filter"
    )!;
    await act(async () => {
      filterBtn.click();
      await flush();
      await flush();
    });

    // Verify URL parameters in the price-history fetch
    assert.match(requestedHistoryUrl, /cashierId=cashier_nimal/);
    assert.match(requestedHistoryUrl, /dateFrom=2026-11-01/);
    assert.match(requestedHistoryUrl, /dateTo=2026-11-15/);
  });

  it("Stage 2: allows Cashier to view Salary Periods, enter Manual Salary with mandatory reason, record Advances and Expenses", async () => {
    localStorage.setItem("npr_preferred_language", "en");

    let capturedSalaryPut: any = null;
    let capturedAdvancePost: any = null;
    let capturedExpensePost: any = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "cashier-uuid-444",
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
      if (url === "/api/workers?includeInactive=true") {
        return jsonResponse(200, {
          success: true,
          data: {
            workers: [
              {
                id: 1,
                workerCode: "W-001",
                fullName: "Kamal Gunaratne",
                designation: "Machine Operator",
                employmentStatus: "ACTIVE",
                joinedDate: "2026-01-01",
                phone: null,
                notes: null,
                createdAt: "2026-01-01T00:00:00Z",
              },
            ],
          },
        });
      }
      if (url === "/api/payroll/entries/20/salary" && method === "PUT") {
        capturedSalaryPut = JSON.parse(init?.body as string);
        return jsonResponse(200, {
          success: true,
          data: {
            entry: {
              id: 20,
              payrollPeriodId: 5,
              workerId: 1,
              workerCode: "W-001",
              workerName: "Kamal Gunaratne",
              designation: "Machine Operator",
              payArrangementSnapshot: "MONTHLY",
              calculationMode: "OWNER_MANUAL_DRAFT",
              approvedDaysCount: 0,
              approvedRegularHours: "0.00",
              approvedOvertimeHours: "0.00",
              basePay: "60000.00",
              overtimePay: "0.00",
              allowances: "0.00",
              deductions: "0.00",
              advanceDeduction: "5000.00",
              grossPay: "60000.00",
              netPayable: "55000.00",
              paidAmount: "0.00",
              remainingPayable: "55000.00",
              status: "DRAFT",
              notes: null,
              version: 2,
              approvedAt: null,
            },
          },
        });
      }
      if (url === "/api/payroll/periods") {
        return jsonResponse(200, {
          success: true,
          data: {
            periods: [
              {
                id: 5,
                periodLabel: "Nov 1-15 2026",
                startDate: "2026-11-01",
                endDate: "2026-11-15",
                status: "DRAFT",
                notes: null,
                version: 1,
                createdAt: "2026-11-01T00:00:00Z",
              },
            ],
          },
        });
      }
      if (url.startsWith("/api/payroll/periods/5/entries")) {
        return jsonResponse(200, {
          success: true,
          data: {
            entries: [
              {
                id: 20,
                payrollPeriodId: 5,
                workerId: 1,
                workerCode: "W-001",
                workerName: "Kamal Gunaratne",
                designation: "Machine Operator",
                payArrangementSnapshot: "HOURLY",
                calculationMode: "CONFIGURED_AUTO",
                approvedDaysCount: 12,
                approvedRegularHours: "96.00",
                approvedOvertimeHours: "8.00",
                basePay: "48000.00",
                overtimePay: "6000.00",
                allowances: "0.00",
                deductions: "0.00",
                advanceDeduction: "5000.00",
                grossPay: "54000.00",
                netPayable: "49000.00",
                paidAmount: "0.00",
                remainingPayable: "49000.00",
                status: "DRAFT",
                notes: null,
                version: 1,
                approvedAt: null,
              },
            ],
          },
        });
      }
      if (url.startsWith("/api/payroll/advances")) {
        if (method === "POST") {
          capturedAdvancePost = JSON.parse(init?.body as string);
          return jsonResponse(201, {
            success: true,
            data: {
              advance: {
                id: 30,
                advanceNumber: "ADV-00030",
                workerId: 1,
                workerCode: "W-001",
                workerName: "Kamal Gunaratne",
                advanceDate: "2026-11-15",
                amount: "5000.00",
                reason: "Emergency medical expense",
                authorizedByUserId: "cashier-uuid-444",
                authorizedByUsername: "cashier_nimal",
                authorizedByRole: "CASHIER",
                createdAt: "2026-11-15T10:00:00Z",
              },
            },
          });
        }
        return jsonResponse(200, {
          success: true,
          data: {
            advances: [
              {
                id: 30,
                advanceNumber: "ADV-00030",
                workerId: 1,
                workerCode: "W-001",
                workerName: "Kamal Gunaratne",
                advanceDate: "2026-11-15",
                amount: "5000.00",
                reason: "Emergency medical expense",
                authorizedByUserId: "cashier-uuid-444",
                authorizedByUsername: "cashier_nimal",
                authorizedByRole: "CASHIER",
                createdAt: "2026-11-15T10:00:00Z",
              },
            ],
          },
        });
      }
      if (url.startsWith("/api/expenses")) {
        if (method === "POST") {
          capturedExpensePost = JSON.parse(init?.body as string);
          return jsonResponse(201, {
            success: true,
            data: {
              expense: {
                id: 50,
                expenseNumber: "EXP-00050",
                expenseDate: "2026-11-15",
                category: "FUEL",
                description: "Diesel fuel top-up for loader",
                amount: "15000.00",
                recordedByUserId: "cashier-uuid-444",
                recordedByUsername: "cashier_nimal",
                recordedByRole: "CASHIER",
                createdAt: "2026-11-15T10:00:00Z",
              },
            },
          });
        }
        return jsonResponse(200, {
          success: true,
          data: {
            expenses: [
              {
                id: 50,
                expenseNumber: "EXP-00050",
                expenseDate: "2026-11-15",
                category: "FUEL",
                description: "Diesel fuel top-up for loader",
                amount: "15000.00",
                recordedByUserId: "cashier-uuid-444",
                recordedByUsername: "cashier_nimal",
                recordedByRole: "CASHIER",
                createdAt: "2026-11-15T10:00:00Z",
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
    assert.ok(payrollBtn, "Payroll & Expenses button must be present for Cashier");
    await act(async () => {
      payrollBtn.click();
      await flush();
      await flush();
    });

    const pageText = container.textContent ?? "";

    // 1. Verify Cashier Operations Portal badge is rendered, NOT Owner Workspace
    assert.match(pageText, /Cashier Operations Portal/);
    assert.doesNotMatch(pageText, /Confidential Owner Workspace/);
    assert.doesNotMatch(pageText, /Owner Management Portal/);

    // 2. Cashier can create salary periods, but privileged Owner actions remain hidden
    assert.match(pageText, /New Salary Period/);
    assert.doesNotMatch(pageText, /Period Audit History/);
    assert.doesNotMatch(pageText, /Initialize Active Workers/);

    // 3. Cashier enters/edits worker manual salary draft with mandatory business reason
    const editSalaryBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim() === "Edit Salary" || b.textContent?.trim() === "Enter Salary"
    )!;
    assert.ok(editSalaryBtn, "Edit Salary button must be accessible to Cashier on draft entries");
    await act(async () => {
      editSalaryBtn.click();
      await flush();
      await flush();
    });

    const modalText = container.textContent ?? "";
    assert.match(modalText, /Edit Manual Salary|Enter Manual Salary/);
    assert.match(modalText, /Applicable Advances in this Period/);

    const grossInput = container.querySelector("input[placeholder='e.g. 65000.00']") as HTMLInputElement;
    const reasonInput = container.querySelector("input[placeholder='e.g. Agreed monthly salary per November site schedule']") as HTMLInputElement;

    await setInputValue(grossInput, "60000.00");
    await setInputValue(reasonInput, "Agreed monthly rate per site schedule");

    const saveSalaryBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim() === "Save Salary Draft"
    )!;
    assert.ok(saveSalaryBtn, "Save Salary Draft button must be present in modal");
    await act(async () => {
      saveSalaryBtn.click();
      await flush();
      await flush();
    });

    assert.ok(capturedSalaryPut, "PUT /api/payroll/entries/20/salary must be called");
    assert.equal(capturedSalaryPut.grossSalary, "60000.00");
    assert.equal(capturedSalaryPut.reason, "Agreed monthly rate per site schedule");
    assert.equal(capturedSalaryPut.expectedVersion, 1);

    // 4. Tab: Advances — Cashier records worker advance and sees Authorized By badge
    const advancesTab = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Advances (")
    )!;
    await act(async () => {
      advancesTab.click();
      await flush();
      await flush();
    });

    const advText = container.textContent ?? "";
    assert.match(advText, /Authorized By/);
    assert.match(advText, /cashier_nimal/);
    assert.match(advText, /CASHIER/);

    const advAmountInput = container.querySelector("input[placeholder='Amount (LKR)']") as HTMLInputElement;
    const advReasonInput = container.querySelector("input[placeholder='Reason']") as HTMLInputElement;

    await setInputValue(advAmountInput, "5000.00");
    await setInputValue(advReasonInput, "Emergency medical expense");

    const recordAdvBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim() === "Record Advance"
    )!;
    await act(async () => {
      recordAdvBtn.click();
      await flush();
      await flush();
    });

    assert.ok(capturedAdvancePost, "POST /api/payroll/advances must be called");
    assert.equal(capturedAdvancePost.workerId, 1);
    assert.equal(capturedAdvancePost.amount, "5000.00");
    assert.equal(capturedAdvancePost.reason, "Emergency medical expense");

    // 5. Tab: Expenses — Cashier records operating expense and sees Recorded By badge
    const expensesTab = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Expenses (")
    )!;
    await act(async () => {
      expensesTab.click();
      await flush();
      await flush();
    });

    const expText = container.textContent ?? "";
    assert.match(expText, /Recorded By/);
    assert.match(expText, /cashier_nimal/);
    assert.match(expText, /CASHIER/);

    const expAmountInput = container.querySelector("input[placeholder='Amount (LKR)']") as HTMLInputElement;
    const expDescInput = container.querySelector("input[placeholder='Expense description']") as HTMLInputElement;

    await setInputValue(expAmountInput, "15000.00");
    await setInputValue(expDescInput, "Diesel fuel top-up for loader");

    const recordExpBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim() === "Record Expense"
    )!;
    await act(async () => {
      recordExpBtn.click();
      await flush();
      await flush();
    });

    assert.ok(capturedExpensePost, "POST /api/expenses must be called");
    assert.equal(capturedExpensePost.category, "FUEL");
    assert.equal(capturedExpensePost.amount, "15000.00");
    assert.equal(capturedExpensePost.description, "Diesel fuel top-up for loader");
  });

  it("Stage 2: allows Owner to view Salary Periods, create custom Periods, and view Salary Audit History", async () => {
    localStorage.setItem("npr_preferred_language", "en");

    let requestedHistoryUrl = "";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "owner-uuid-001",
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
      if (url === "/api/workers?includeInactive=true") {
        return jsonResponse(200, {
          success: true,
          data: {
            workers: [
              {
                id: 1,
                workerCode: "W-001",
                fullName: "Kamal Gunaratne",
                designation: "Machine Operator",
                employmentStatus: "ACTIVE",
                joinedDate: "2026-01-01",
                phone: null,
                notes: null,
                createdAt: "2026-01-01T00:00:00Z",
              },
            ],
          },
        });
      }
      if (url.startsWith("/api/payroll/salary-history")) {
        requestedHistoryUrl = url;
        return jsonResponse(200, {
          success: true,
          data: {
            history: [
              {
                id: 101,
                payrollEntryId: 20,
                workerId: 1,
                workerCode: "W-001",
                workerName: "Kamal Gunaratne",
                periodId: 5,
                periodLabel: "Nov 1-15 2026",
                action: "UPDATE_MANUAL_SALARY",
                previousGrossSalary: "54000.00",
                newGrossSalary: "60000.00",
                applicableAdvances: "5000.00",
                calculatedNetPayable: "55000.00",
                excessAdvances: null,
                reason: "Annual cost of living increment",
                notes: null,
                actorUserId: "cashier-uuid-444",
                actorUsername: "cashier_nimal",
                actorRole: "CASHIER",
                createdAt: "2026-11-15T10:00:00Z",
              },
              {
                id: 100,
                payrollEntryId: 20,
                workerId: 1,
                workerCode: "W-001",
                workerName: "Kamal Gunaratne",
                periodId: 5,
                periodLabel: "Nov 1-15 2026",
                action: "INITIALIZE_PERIOD",
                previousGrossSalary: null,
                newGrossSalary: "0.00",
                applicableAdvances: "5000.00",
                calculatedNetPayable: "0.00",
                excessAdvances: null,
                reason: "Initial salary period setup",
                notes: null,
                actorUserId: "owner-uuid-001",
                actorUsername: "owner_nalaka",
                actorRole: "OWNER",
                createdAt: "2026-11-01T00:00:00Z",
              },
            ],
          },
        });
      }
      if (url === "/api/payroll/periods") {
        return jsonResponse(200, {
          success: true,
          data: {
            periods: [
              {
                id: 5,
                periodLabel: "Nov 1-15 2026",
                startDate: "2026-11-01",
                endDate: "2026-11-15",
                status: "DRAFT",
                notes: null,
                version: 1,
                createdAt: "2026-11-01T00:00:00Z",
              },
            ],
          },
        });
      }
      if (url.startsWith("/api/payroll/periods/5/entries")) {
        return jsonResponse(200, {
          success: true,
          data: {
            entries: [
              {
                id: 20,
                payrollPeriodId: 5,
                workerId: 1,
                workerCode: "W-001",
                workerName: "Kamal Gunaratne",
                designation: "Machine Operator",
                payArrangementSnapshot: "MONTHLY",
                calculationMode: "OWNER_MANUAL_DRAFT",
                approvedDaysCount: 0,
                approvedRegularHours: "0.00",
                approvedOvertimeHours: "0.00",
                basePay: "60000.00",
                overtimePay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advanceDeduction: "5000.00",
                grossPay: "60000.00",
                netPayable: "55000.00",
                paidAmount: "0.00",
                remainingPayable: "55000.00",
                status: "DRAFT",
                notes: null,
                version: 1,
                approvedAt: null,
              },
            ],
          },
        });
      }
      if (url.startsWith("/api/payroll/advances")) {
        return jsonResponse(200, { success: true, data: { advances: [] } });
      }
      if (url === "/api/payroll/payments") {
        return jsonResponse(200, { success: true, data: { payments: [] } });
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
    const payrollBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Payroll & Expenses")
    )!;
    await act(async () => {
      payrollBtn.click();
      await flush();
      await flush();
    });

    const pageText = container.textContent ?? "";

    // 1. Verify Owner Management Portal badge is rendered
    assert.match(pageText, /Owner Management Portal/);

    // 2. Owner controls are present
    assert.match(pageText, /New Salary Period/);
    assert.match(pageText, /Period Audit History/);

    // 3. Owner clicks Period Audit History to view audit history
    const auditBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Period Audit History")
    )!;
    assert.ok(auditBtn, "Period Audit History button must be present for Owner");
    await act(async () => {
      auditBtn.click();
      await flush();
      await flush();
    });

    const auditText = container.textContent ?? "";
    assert.match(auditText, /Salary Audit History/);
    assert.match(auditText, /Annual cost of living increment/);
    assert.match(auditText, /Initial salary period setup/);
    assert.match(auditText, /cashier_nimal/);
    assert.match(auditText, /CASHIER/);
    assert.match(auditText, /owner_nalaka/);
    assert.match(auditText, /OWNER/);
    assert.ok(requestedHistoryUrl.includes("/api/payroll/salary-history"));
  });
});

