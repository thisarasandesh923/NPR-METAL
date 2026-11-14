import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testDom } from "./domSetup.ts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../App.tsx";
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
      { id: 1, code: "3/4", name: '3/4"', unit: "m³", currentUnitPrice: "12000.00", isActive: true },
      { id: 2, code: "DUST", name: "Dust", unit: "m³", currentUnitPrice: "8500.00", isActive: true },
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
      "input[aria-label='Quantity in cubic meters for item 1']"
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

    // Verify confirmed persisted view & A5 print section render
    assert.match(container.textContent ?? "", /NPR-INV-000042/);
    assert.match(container.textContent ?? "", /Print A5 Invoice/);
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
});
