import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testDom } from "./domSetup.ts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../App.tsx";
import { AuthProvider } from "../context/AuthContext.tsx";
import { LanguageProvider } from "../i18n/LanguageContext.tsx";
import { InvoiceDetailPage } from "../features/invoices/components/InvoiceDetailPage.tsx";
import { formatColomboDateTime, formatLkr } from "../utils/formatters.ts";
import type { InvoiceDetail, MaterialCatalogItem } from "../types/billing.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

async function setInputValue(
  input: HTMLInputElement | HTMLSelectElement,
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

describe("Phase 4 Billing MVP — Frontend Invoice, Payment, A5 Print & Owner Views", () => {
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

  it("formats LKR fixed-point strings and Asia/Colombo timestamps accurately", () => {
    assert.equal(formatLkr("102000.00"), "Rs. 102,000.00");
    assert.equal(formatLkr("9563.06"), "Rs. 9,563.06");
    assert.match(formatColomboDateTime("2026-11-12T10:30:00.000Z"), /2026/);
  });

  it("completes CASHIER invoice creation from live materials, A5 print rendering, and subsequent payment recording", async () => {
    localStorage.setItem("npr_preferred_language", "en");
    const materials: MaterialCatalogItem[] = [
      {
        id: 1,
        code: "3/4",
        name: '3/4"',
        unit: "ft³",
        currentUnitPrice: "12000.00",
        tractorPricePerFt3: "12000.00",
        tipperPricePerFt3: "12500.00",
        vehiclePrices: {
          TRACTOR: { vehicleCategory: "TRACTOR", pricePerFt3: "12000.00", version: 1, updatedAt: new Date().toISOString() },
          TIPPER: { vehicleCategory: "TIPPER", pricePerFt3: "12500.00", version: 1, updatedAt: new Date().toISOString() },
        },
        isActive: true,
      },
      {
        id: 2,
        code: "DUST",
        name: "Dust",
        unit: "ft³",
        currentUnitPrice: "8500.00",
        tractorPricePerFt3: "8500.00",
        tipperPricePerFt3: "9000.00",
        vehiclePrices: {
          TRACTOR: { vehicleCategory: "TRACTOR", pricePerFt3: "8500.00", version: 1, updatedAt: new Date().toISOString() },
          TIPPER: { vehicleCategory: "TIPPER", pricePerFt3: "9000.00", version: 1, updatedAt: new Date().toISOString() },
        },
        isActive: true,
      },
    ];

    let savedInvoice: InvoiceDetail | null = null;
    const captured: {
      issueBody: Record<string, unknown> | null;
      paymentBody: Record<string, unknown> | null;
    } = { issueBody: null, paymentBody: null };

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "c-1",
              username: "cashier1",
              fullName: "Nimal Jayawardena",
              role: "CASHIER",
            },
          },
        });
      }

      if (url === "/api/materials") {
        assert.equal(init?.credentials, "include");
        return jsonResponse(200, { success: true, data: { materials } });
      }

      if (url.startsWith("/api/customers")) {
        return jsonResponse(200, { success: true, data: { customers: [] } });
      }

      if (url === "/api/invoices" && (!init?.method || init.method === "GET")) {
        return jsonResponse(200, {
          success: true,
          data: { invoices: savedInvoice ? [savedInvoice] : [] },
        });
      }

      if (url.startsWith("/api/invoices?") && (!init?.method || init.method === "GET")) {
        return jsonResponse(200, {
          success: true,
          data: { invoices: savedInvoice ? [savedInvoice] : [] },
        });
      }

      if (url === "/api/invoices" && init?.method === "POST") {
        const hdrs = init.headers as Record<string, string>;
        assert.equal(hdrs["X-Requested-With"], "XMLHttpRequest");
        assert.equal(init.credentials, "include");
        captured.issueBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        savedInvoice = {
          id: 42,
          invoiceNumber: "NPR-INV-000042",
          customerId: 7,
          customerName: "Saman Builders",
          customerPhone: "0771234567",
          customerLocation: "Kurunegala",
          hasTransport: true,
          transportFee: "5000.00",
          subtotal: "24000.00",
          grandTotal: "29000.00",
          effectiveGrandTotal: "29000.00",
          paidAmount: "10000.00",
          balanceDue: "19000.00",
          paymentStatus: "PARTIALLY_PAID",
          invoiceStatus: "ISSUED",
          issuedByUserId: "c-1",
          issuedByName: "Nimal Jayawardena",
          issuedAt: "2026-11-12T14:00:00.000Z",
          businessDate: "2026-11-12",
          items: [
            {
              id: 1,
              materialId: 1,
              materialName: '3/4"',
              quantity: "2.000",
              unitPrice: "12000.00",
              lineTotal: "24000.00",
            },
          ],
          payments: [
            {
              id: 11,
              receiptNumber: "NPR-REC-000011",
              invoiceId: 42,
              cashierUserId: "c-1",
              cashierName: "Nimal Jayawardena",
              amount: "10000.00",
              paymentMethod: "CASH",
              notes: "Initial payment",
              createdAt: "2026-11-12T14:00:00.000Z",
            },
          ],
        };
        return jsonResponse(201, {
          success: true,
          data: { invoice: savedInvoice, replayed: false },
        });
      }

      if (url === "/api/payments" && init?.method === "POST") {
        const hdrs = init.headers as Record<string, string>;
        assert.equal(hdrs["X-Requested-With"], "XMLHttpRequest");
        assert.equal(init.credentials, "include");
        captured.paymentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        const newPayment = {
          id: 12,
          receiptNumber: "NPR-REC-000012",
          invoiceId: 42,
          cashierUserId: "c-1",
          cashierName: "Nimal Jayawardena",
          amount: "19000.00",
          paymentMethod: "CASH" as const,
          notes: null,
          createdAt: "2026-11-12T14:05:00.000Z",
        };
        savedInvoice = {
          ...savedInvoice!,
          paidAmount: "29000.00",
          balanceDue: "0.00",
          paymentStatus: "PAID",
          payments: [...savedInvoice!.payments, newPayment],
        };
        return jsonResponse(201, {
          success: true,
          data: { payment: newPayment, invoice: savedInvoice, replayed: false },
        });
      }

      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    }) as typeof globalThis.fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });
    await act(async () => {
      await flush();
    });

    assert.match(container.textContent ?? "", /Cashier Dashboard/);

    // Navigate to New Invoice
    const createBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create New Invoice")
    )!;
    await act(async () => {
      createBtn.click();
      await flush();
      await flush();
    });

    // Print A5 button must NOT exist before persistence
    assert.doesNotMatch(container.textContent ?? "", /Print A5 Invoice/);

    await setInputValue(
      container.querySelector("input[name='customerName']") as HTMLInputElement,
      "Saman Builders"
    );
    await setInputValue(
      container.querySelector("input[name='customerPhone']") as HTMLInputElement,
      "0771234567"
    );
    await setInputValue(
      container.querySelector("input[name='customerLocation']") as HTMLInputElement,
      "Kurunegala"
    );

    const qtyInput = container.querySelector(
      "input[aria-label='Quantity in cubic feet for item 1']"
    ) as HTMLInputElement;
    await setInputValue(qtyInput, "2.000");

    const withTransportBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("With Transport")
    )!;
    await act(async () => {
      withTransportBtn.click();
    });
    await setInputValue(
      container.querySelector("input[name='transportFee']") as HTMLInputElement,
      "5000.00"
    );
    await setInputValue(
      container.querySelector("input[name='initialPaymentAmount']") as HTMLInputElement,
      "10000.00"
    );

    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Issue & Save Invoice")
    )!;
    await act(async () => {
      saveBtn.click();
      await flush();
    });

    // Verify invoice issue request did not send client unit prices and sent UUID idempotencyKey
    assert.ok(captured.issueBody);
    assert.equal(typeof captured.issueBody.idempotencyKey, "string");
    assert.ok((captured.issueBody.idempotencyKey as string).length >= 16);
    assert.equal(captured.issueBody.vehicleCategory, "TRACTOR");

    // Verify confirmed persisted view & A5 print section render
    assert.match(container.textContent ?? "", /NPR-INV-000042/);
    assert.match(container.textContent ?? "", /Print A5 Invoice/);
    assert.match(container.textContent ?? "", /Print 80mm Receipt/);
    assert.match(container.textContent ?? "", /NPR METAL CRUSHER/);
    assert.match(container.textContent ?? "", /NPR-REC-000011/);

    // Record subsequent payment cleanly
    const recordPayBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Record Cash Payment")
    )!;
    await act(async () => {
      recordPayBtn.click();
    });
    const savePayBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Save Cash Payment")
    )!;
    await act(async () => {
      savePayBtn.click();
      await flush();
    });

    assert.ok(captured.paymentBody);
    assert.equal(captured.paymentBody.amount, "19000.00");
    assert.match(container.textContent ?? "", /NPR-REC-000012/);
    assert.match(container.textContent ?? "", /Rs\. 29,000\.00/);
  });

  it("renders live PostgreSQL financial overview metrics and saved invoices on OwnerDashboard", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "o-1",
              username: "owner1",
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
              todayInvoiceCount: 3,
              todayBilledTotal: "155000.00",
              todayCashCollected: "120000.00",
              todayReceiptCount: 2,
              totalOutstandingBalance: "35000.00",
              openInvoicesCount: 1,
              totalIssuedInvoicesCount: 3,
            },
          },
        });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, {
          success: true,
          data: {
            invoices: [
              {
                id: 99,
                invoiceNumber: "NPR-INV-000099",
                customerId: 5,
                customerName: "Kurunegala Hardware",
                customerPhone: "0372223344",
                customerLocation: "Kurunegala",
                hasTransport: false,
                transportFee: "0.00",
                subtotal: "35000.00",
                grandTotal: "35000.00",
                effectiveGrandTotal: "35000.00",
                paidAmount: "0.00",
                balanceDue: "35000.00",
                paymentStatus: "UNPAID",
                invoiceStatus: "ISSUED",
                issuedByUserId: "c-1",
                issuedByName: "Cashier 1",
                issuedAt: "2026-11-12T08:00:00.000Z",
                businessDate: "2026-11-12",
              },
            ],
          },
        });
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    }) as typeof globalThis.fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });
    await act(async () => {
      await flush();
    });

    assert.match(container.textContent ?? "", /Owner Management Portal/);
    assert.match(container.textContent ?? "", /Rs\. 155,000\.00/);
    assert.match(container.textContent ?? "", /Rs\. 120,000\.00/);
    assert.match(container.textContent ?? "", /Rs\. 35,000\.00/);
    assert.match(container.textContent ?? "", /NPR-INV-000099/);
    assert.match(container.textContent ?? "", /Kurunegala Hardware/);
  });

  it("supports dual print layouts (A5 and 80mm POS Thermal) with correct data and non-interfering styles", async () => {
    const mockInvoice: InvoiceDetail = {
      id: 88,
      invoiceNumber: "NPR-INV-000088",
      customerId: 9,
      customerName: "Sunil Bandara Constructions",
      customerPhone: "0771234567",
      customerLocation: "Ibbagamuwa Quarry Road",
      hasTransport: true,
      transportFee: "5000.00",
      subtotal: "48000.00",
      grandTotal: "53000.00",
      effectiveGrandTotal: "53000.00",
      paidAmount: "25000.00",
      balanceDue: "28000.00",
      paymentStatus: "PARTIALLY_PAID",
      invoiceStatus: "ISSUED",
      issuedByUserId: "c-1",
      issuedByName: "Nimal Jayawardena",
      issuedAt: "2026-11-15T10:30:00.000Z",
      businessDate: "2026-11-15",
      items: [
        {
          id: 1,
          materialId: 1,
          materialName: "3/4 Metal",
          quantity: "4.000",
          unitPrice: "12000.00",
          lineTotal: "48000.00",
        },
      ],
      payments: [
        {
          id: 101,
          receiptNumber: "NPR-RCP-000101",
          invoiceId: 88,
          cashierUserId: "c-1",
          cashierName: "Nimal Jayawardena",
          amount: "25000.00",
          paymentMethod: "CASH",
          notes: "Initial advance",
          createdAt: "2026-11-15T10:30:00.000Z",
        },
      ],
      adjustments: [],
    };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "c-1",
              username: "cashier1",
              fullName: "Nimal Jayawardena",
              role: "CASHIER",
            },
          },
        });
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    }) as typeof globalThis.fetch;

    const printCalls: string[] = [];
    (window as any).print = () => {
      printCalls.push(document.body.getAttribute("data-print-format") ?? "default");
    };

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(
            LanguageProvider,
            null,
            React.createElement(InvoiceDetailPage, {
              initialInvoice: mockInvoice,
              onBack: () => {},
            })
          )
        )
      );
    });
    await act(async () => {
      await flush();
      await flush();
    });

    // 1. Verify presence of both print buttons
    const a5Btn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Print A5 Invoice")
    );
    const thermalBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Print 80mm Receipt")
    );
    assert.ok(a5Btn, "Expected 'Print A5 Invoice' button");
    assert.ok(thermalBtn, "Expected 'Print 80mm Receipt' button");

    // 2. Verify thermal receipt layout elements
    const thermalSheet = container.querySelector(".print-thermal-sheet");
    assert.ok(thermalSheet, "Expected .print-thermal-sheet element");
    const thermalText = thermalSheet.textContent ?? "";

    assert.match(thermalText, /N\.?\s*P\.?\s*R\.?\s*METAL CRUSHER/);
    assert.match(thermalText, /Seenimodara/);
    assert.match(thermalText, /071 4470495/);
    assert.match(thermalText, /077 6159861/);
    assert.match(thermalText, /047 3129921/);
    assert.match(thermalText, /H\/6\/3134/);
    assert.match(thermalText, /Customer \/ පාරිභෝගිකයා/);
    assert.match(thermalText, /Location \/ ස්ථානය/);
    assert.match(thermalText, /T\.P \/ දුරකථන/);
    assert.match(thermalText, /Invoice \/ බිල්පත/);
    assert.match(thermalText, /Date \/ දිනය/);
    assert.match(thermalText, /Time \/ වේලාව/);
    assert.match(thermalText, /Total \/ එකතුව/);
    assert.match(thermalText, /Balance \/ ඉතිරිය/);
    assert.match(thermalText, /NPR-INV-000088/);
    assert.match(thermalText, /Sunil Bandara Constructions/);
    assert.match(thermalText, /0771234567/);
    assert.match(thermalText, /Ibbagamuwa Quarry Road/);
    assert.match(thermalText, /3\/4 Metal/);
    assert.match(thermalText, /4\.000 m³/);
    assert.match(thermalText, /48,000\.00/);
    assert.match(thermalText, /Rs\. 5,000\.00/);
    assert.match(thermalText, /Rs\. 53,000\.00/);
    assert.match(thermalText, /Rs\. 25,000\.00/);
    assert.match(thermalText, /Rs\. 28,000\.00/);
    assert.match(thermalText, /PARTIAL/);
    assert.match(thermalText, /Thank You!/);
    assert.match(thermalText, /ස්තූතියි!/);

    // Verify unnecessary metadata was removed from 80mm thermal receipt
    assert.doesNotMatch(thermalText, /Proprietor/);
    assert.doesNotMatch(thermalText, /NPR-RCP/);
    assert.doesNotMatch(thermalText, /Rate Category/);
    assert.doesNotMatch(thermalText, /\*\*\* END OF RECEIPT/);

    // Verify A5 sheet branding
    const a5Sheet = container.querySelector(".print-a5-sheet");
    assert.ok(a5Sheet, "Expected .print-a5-sheet element");
    const a5Text = a5Sheet.textContent ?? "";
    assert.match(a5Text, /NPR METAL CRUSHER/);
    assert.match(a5Text, /Seenimodara, Sri Lanka/);
    assert.match(a5Text, /Proprietor: Nalaka Ranasinghe/);

    // 3. Test triggering 80mm Thermal Receipt printing
    await act(async () => {
      thermalBtn.click();
    });
    assert.equal(printCalls.length, 1);
    assert.equal(printCalls[0], "thermal80");
    assert.equal(document.body.getAttribute("data-print-format"), "thermal80");

    const pageStyleEl = document.getElementById("npr-print-page-style");
    assert.ok(pageStyleEl);
    assert.match(pageStyleEl.textContent ?? "", /size: 80mm auto/);

    // Simulate afterprint event
    await act(async () => {
      window.dispatchEvent(new window.Event("afterprint"));
    });
    assert.equal(document.body.getAttribute("data-print-format"), null);
    assert.equal(document.getElementById("npr-print-page-style"), null);

    // 4. Test triggering A5 Invoice printing
    await act(async () => {
      a5Btn.click();
    });
    assert.equal(printCalls.length, 2);
    assert.equal(printCalls[1], "a5");
    assert.equal(document.body.getAttribute("data-print-format"), "a5");

    const a5StyleEl = document.getElementById("npr-print-page-style");
    assert.ok(a5StyleEl);
    assert.match(a5StyleEl.textContent ?? "", /size: A5 portrait/);

    await act(async () => {
      window.dispatchEvent(new window.Event("afterprint"));
    });
    assert.equal(document.body.getAttribute("data-print-format"), null);
    assert.equal(document.getElementById("npr-print-page-style"), null);
  });
});
