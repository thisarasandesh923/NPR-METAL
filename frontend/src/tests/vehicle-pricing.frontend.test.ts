import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testDom } from "./domSetup.ts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../App.tsx";
import { AuthProvider } from "../context/AuthContext.tsx";
import { LanguageProvider } from "../i18n/LanguageContext.tsx";
import { InvoiceDetailPage } from "../features/invoices/components/InvoiceDetailPage.tsx";
import { InvoicePrintThermal80 } from "../features/invoices/components/InvoicePrintThermal80.tsx";
import type { InvoiceDetail, MaterialCatalogItem, VehicleCategory } from "../types/billing.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function flush(ms = 15): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

describe("Vehicle-Specific Material Pricing & ft³ Invoicing — Frontend Tests", () => {
  let container: HTMLElement;
  let root: Root | null = null;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    testDom.window.document.body.innerHTML = "<div id='root'></div>";
    container = testDom.window.document.getElementById("root")!;
    originalFetch = globalThis.fetch;
    localStorage.clear();
    sessionStorage.clear();
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

  const catalogWithVehiclePrices: MaterialCatalogItem[] = [
    {
      id: 1,
      code: "3/4",
      name: "3/4 Metal",
      unit: "ft³",
      currentUnitPrice: "12000.00",
      tractorPricePerFt3: "45.00",
      tipperPricePerFt3: "48.00",
      vehiclePrices: {
        TRACTOR: {
          vehicleCategory: "TRACTOR",
          pricePerFt3: "45.00",
          version: 1,
          updatedAt: "2026-11-23T06:00:00.000Z",
        },
        TIPPER: {
          vehicleCategory: "TIPPER",
          pricePerFt3: "48.00",
          version: 2,
          updatedAt: "2026-11-23T06:00:00.000Z",
        },
      },
      isActive: true,
      version: 1,
    },
    {
      id: 2,
      code: "DUST",
      name: "Dust",
      unit: "ft³",
      currentUnitPrice: "8500.00",
      tractorPricePerFt3: "35.00",
      tipperPricePerFt3: null, // Tipper price unconfigured!
      vehiclePrices: {
        TRACTOR: {
          vehicleCategory: "TRACTOR",
          pricePerFt3: "35.00",
          version: 1,
          updatedAt: "2026-11-23T06:00:00.000Z",
        },
        TIPPER: null,
      },
      isActive: true,
      version: 1,
    },
  ];

  it("1. New Invoice: displays Selling Price Category selector (Tractor / Tipper) and dynamically updates ft³ prices", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: { id: "c-1", username: "cashier1", fullName: "Nimal", role: "CASHIER" },
          },
        });
      }
      if (url.startsWith("/api/materials")) {
        return jsonResponse(200, { success: true, data: { materials: catalogWithVehiclePrices } });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url.startsWith("/api/customers")) {
        return jsonResponse(200, { success: true, data: { customers: [] } });
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    }) as typeof globalThis.fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });
    await act(async () => {
      await flush();
      await flush();
    });

    // Navigate to New Invoice
    const newInvBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create New Invoice")
    )!;
    await act(async () => {
      newInvBtn.click();
      await flush();
      await flush();
    });

    const pageText = container.textContent ?? "";
    assert.match(pageText, /Selling Price Category/);
    assert.match(pageText, /Tractor/);
    assert.match(pageText, /Tipper/);

    // Initial default is TRACTOR, so 3/4 Metal unit price should show Rs. 45.00
    const priceInput = container.querySelector(
      "input[aria-label='3/4 Metal unit price']"
    ) as HTMLInputElement;
    assert.ok(priceInput, "Expected price input for 3/4 Metal");
    assert.equal(priceInput.value, "45.00");

    // Switching to Tipper updates unit price to Rs. 48.00
    const tipperRadio = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("role") === "radio" && b.textContent?.includes("Tipper")
    )!;
    await act(async () => {
      tipperRadio.click();
      await flush();
    });

    assert.equal(priceInput.value, "48.00");

    // Quantity unit is ft³
    assert.match(container.textContent ?? "", /ft³/);
    const qtyInput = container.querySelector(
      "input[aria-label='Quantity in cubic feet for item 1']"
    ) as HTMLInputElement;
    assert.ok(qtyInput, "Expected quantity input with ft³ aria-label");
  });

  it("2. Unconfigured Price: blocks invoice creation and displays clear warning when a material has no price for the selected category", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: { id: "c-1", username: "cashier1", fullName: "Nimal", role: "CASHIER" },
          },
        });
      }
      if (url.startsWith("/api/materials")) {
        return jsonResponse(200, { success: true, data: { materials: catalogWithVehiclePrices } });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url.startsWith("/api/customers")) {
        return jsonResponse(200, { success: true, data: { customers: [] } });
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    }) as typeof globalThis.fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });
    await act(async () => {
      await flush();
      await flush();
    });

    const newInvBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create New Invoice")
    )!;
    await act(async () => {
      newInvBtn.click();
      await flush();
      await flush();
    });

    // Select "Dust" (id: 2) which has Tractor price 35.00, but Tipper price null
    const matSelect = container.querySelector(
      "select[aria-label='Material item 1']"
    ) as HTMLSelectElement;
    await setInputValue(matSelect, "2");

    // Under Tractor, price is 35.00 and no warning
    const tractorPriceInput = container.querySelector(
      "input[aria-label='Dust unit price']"
    ) as HTMLInputElement;
    assert.equal(tractorPriceInput.value, "35.00");
    assert.doesNotMatch(container.textContent ?? "", /is unconfigured for/);

    // Switch to TIPPER
    const tipperRadio = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("role") === "radio" && b.textContent?.includes("Tipper")
    )!;
    await act(async () => {
      tipperRadio.click();
      await flush();
    });

    // Should display warning and "Unconfigured"
    assert.equal(tractorPriceInput.value, "Unconfigured");
    assert.match(container.textContent ?? "", /Price for Dust is unconfigured for TIPPER/);

    // Save button must be disabled
    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Issue & Save Invoice")
    ) as HTMLButtonElement;
    assert.ok(saveBtn.disabled, "Submit button should be disabled when price is unconfigured");

    // Switch back to TRACTOR -> warning disappears and submit is re-enabled
    const tractorRadio = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("role") === "radio" && b.textContent?.includes("Tractor")
    )!;
    await act(async () => {
      tractorRadio.click();
      await flush();
    });

    assert.equal(tractorPriceInput.value, "35.00");
    assert.doesNotMatch(container.textContent ?? "", /is unconfigured for/);
  });

  it("3. Never falls back to legacy currentUnitPrice (m³) when vehicle price is null", async () => {
    const legacyOnlyMaterial: MaterialCatalogItem[] = [
      {
        id: 10,
        code: "LEGACY",
        name: "Legacy Aggregate",
        unit: "m³",
        currentUnitPrice: "15000.00", // Legacy m³ price exists
        tractorPricePerFt3: null,     // Ft³ price NOT set!
        tipperPricePerFt3: null,      // Ft³ price NOT set!
        isActive: true,
        version: 1,
      },
    ];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: { id: "c-1", username: "cashier1", fullName: "Nimal", role: "CASHIER" },
          },
        });
      }
      if (url.startsWith("/api/materials")) {
        return jsonResponse(200, { success: true, data: { materials: legacyOnlyMaterial } });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url.startsWith("/api/customers")) {
        return jsonResponse(200, { success: true, data: { customers: [] } });
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    }) as typeof globalThis.fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });
    await act(async () => {
      await flush();
      await flush();
    });

    const newInvBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create New Invoice")
    )!;
    await act(async () => {
      newInvBtn.click();
      await flush();
      await flush();
    });

    const priceInput = container.querySelector(
      "input[aria-label='Legacy Aggregate unit price']"
    ) as HTMLInputElement;
    assert.ok(priceInput);
    // MUST NOT be "15,000.00" or converted
    assert.notEqual(priceInput.value, "15,000.00");
    assert.notEqual(priceInput.value, "15000.00");
    assert.equal(priceInput.value, "Unconfigured");
    assert.match(container.textContent ?? "", /Price for Legacy Aggregate is unconfigured/);
  });

  it("4. Submits invoice with vehicleCategory, ft³ quantities, and preserves unchanged transport calculations", async () => {
    let capturedPayload: any = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: { id: "c-1", username: "cashier1", fullName: "Nimal", role: "CASHIER" },
          },
        });
      }
      if (url.startsWith("/api/materials")) {
        return jsonResponse(200, { success: true, data: { materials: catalogWithVehiclePrices } });
      }
      if (url === "/api/invoices" && init?.method === "POST") {
        capturedPayload = JSON.parse(String(init.body));
        return jsonResponse(201, {
          success: true,
          data: {
            invoice: {
              id: 99,
              invoiceNumber: "NPR-INV-000099",
              customerId: 1,
              customerName: "Kamal Perera",
              customerPhone: "0771234567",
              customerLocation: "Kurunegala",
              vehicleCategory: "TIPPER",
              unitSnapshot: "ft³",
              hasTransport: true,
              transportFee: "3000.00",
              subtotal: "4800.00",
              grandTotal: "7800.00",
              effectiveGrandTotal: "7800.00",
              paidAmount: "7800.00",
              balanceDue: "0.00",
              paymentStatus: "PAID",
              invoiceStatus: "ISSUED",
              issuedByUserId: "c-1",
              issuedByName: "Nimal",
              issuedAt: new Date().toISOString(),
              businessDate: "2026-11-23",
              items: [
                {
                  id: 1,
                  materialId: 1,
                  materialName: "3/4 Metal",
                  quantity: "100.000",
                  unitPrice: "48.00",
                  lineTotal: "4800.00",
                  unitSnapshot: "ft³",
                  vehicleCategorySnapshot: "TIPPER",
                },
              ],
              payments: [],
            },
            replayed: false,
          },
        });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      if (url.startsWith("/api/customers")) {
        return jsonResponse(200, { success: true, data: { customers: [] } });
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    }) as typeof globalThis.fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });
    await act(async () => {
      await flush();
      await flush();
    });

    const newInvBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create New Invoice")
    )!;
    await act(async () => {
      newInvBtn.click();
      await flush();
      await flush();
    });

    // Fill customer details
    await setInputValue(
      container.querySelector("input[name='customerName']") as HTMLInputElement,
      "Kamal Perera"
    );
    await setInputValue(
      container.querySelector("input[name='customerPhone']") as HTMLInputElement,
      "0771234567"
    );
    await setInputValue(
      container.querySelector("input[name='customerLocation']") as HTMLInputElement,
      "Kurunegala"
    );

    // Select TIPPER rate
    const tipperRadio = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("role") === "radio" && b.textContent?.includes("Tipper")
    )!;
    await act(async () => {
      tipperRadio.click();
      await flush();
    });

    // Enter 100 ft³
    const qtyInput = container.querySelector(
      "input[aria-label='Quantity in cubic feet for item 1']"
    ) as HTMLInputElement;
    await setInputValue(qtyInput, "100.000");

    // Transport section: With Transport Rs. 3000.00
    const withTransportBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("With Transport")
    )!;
    await act(async () => {
      withTransportBtn.click();
      await flush();
    });
    await setInputValue(
      container.querySelector("input[name='transportFee']") as HTMLInputElement,
      "3000.00"
    );

    // Initial Payment: Full pay 7800.00 (48.00 * 100 + 3000.00)
    await setInputValue(
      container.querySelector("input[name='initialPaymentAmount']") as HTMLInputElement,
      "7800.00"
    );

    // Submit
    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Issue & Save Invoice")
    )!;
    await act(async () => {
      saveBtn.click();
      await flush();
      await flush();
    });

    // Assert submitted payload contains vehicleCategory and ft³ quantities
    assert.ok(capturedPayload, "Expected POST /api/invoices payload");
    assert.equal(capturedPayload.vehicleCategory, "TIPPER");
    assert.equal(capturedPayload.items[0].materialId, 1);
    assert.equal(capturedPayload.items[0].quantity, "100.000");
    assert.equal(capturedPayload.hasTransport, true);
    assert.equal(capturedPayload.transportFee, "3000.00");
    assert.equal(capturedPayload.initialPaymentAmount, "7800.00");
  });

  it("5. Material Price Management: displays separate Tractor and Tipper prices and supports independent edits with version checks", async () => {
    let capturedUpdate: any = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: { id: "o-1", username: "owner_nalaka", fullName: "Nalaka Ranasinghe", role: "OWNER" },
          },
        });
      }
      if (url.startsWith("/api/materials?includeInactive=true")) {
        return jsonResponse(200, { success: true, data: { materials: catalogWithVehiclePrices } });
      }
      if (url.startsWith("/api/materials/price-history")) {
        return jsonResponse(200, {
          success: true,
          data: {
            history: [
              {
                id: 1,
                materialId: 1,
                materialCode: "3/4",
                materialName: "3/4 Metal",
                vehicleCategory: "TRACTOR",
                oldPrice: "42.00",
                newPrice: "45.00",
                changedByUsername: "cashier1",
                changedByName: "Nimal",
                changedByRole: "CASHIER",
                reason: "Blasting cost adjustment",
                effectiveAt: "2026-11-23T07:00:00.000Z",
              },
            ],
          },
        });
      }
      if (url === "/api/materials/1/price" && init?.method === "PUT") {
        capturedUpdate = JSON.parse(String(init.body));
        return jsonResponse(200, {
          success: true,
          data: {
            material: {
              ...catalogWithVehiclePrices[0],
              tractorPricePerFt3: capturedUpdate.newPrice,
              vehiclePrices: {
                ...catalogWithVehiclePrices[0].vehiclePrices,
                TRACTOR: {
                  vehicleCategory: "TRACTOR",
                  pricePerFt3: capturedUpdate.newPrice,
                  version: 2,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          },
        });
      }
      if (url.startsWith("/api/reports/overview")) {
        return jsonResponse(200, { success: true, data: { overview: {} } });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    }) as typeof globalThis.fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });
    await act(async () => {
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
    assert.match(pageText, /Material Price Management/);
    assert.match(pageText, /Tractor Price \(Rs\.\/ft³\)/);
    assert.match(pageText, /Tipper Price \(Rs\.\/ft³\)/);

    // Dust should show "Not Set" for Tipper price
    assert.match(pageText, /Not Set/);

    // Audit history should show vehicle category
    assert.match(pageText, /Tractor/);
    assert.match(pageText, /Blasting cost adjustment/);

    // Click Update Price (Tractor) for 3/4 Metal
    const updateTractorBtn = container.querySelector(
      "button[aria-label='Update Tractor Price for 3/4 Metal']"
    ) as HTMLButtonElement;
    assert.ok(updateTractorBtn, "Expected Update Tractor Price button");

    await act(async () => {
      updateTractorBtn.click();
      await flush();
    });

    // Verify modal pre-populates current Tractor rate
    const priceInput = container.querySelector("#price-input") as HTMLInputElement;
    const priceReason = container.querySelector("#price-reason") as HTMLTextAreaElement;
    assert.equal(priceInput.value, "45.00");

    // Enter new Tractor price 47.50
    await setInputValue(priceInput, "47.50");
    await setInputValue(priceReason, "Diesel rate increase per ft³");

    const savePriceBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Save Price Update")
    )!;
    await act(async () => {
      savePriceBtn.click();
      await flush();
      await flush();
    });

    assert.ok(capturedUpdate, "Expected PUT request body");
    assert.equal(capturedUpdate.vehicleCategory, "TRACTOR");
    assert.equal(capturedUpdate.newPrice, "47.50");
    assert.equal(capturedUpdate.expectedVersion, 1);
    assert.equal(capturedUpdate.reason, "Diesel rate increase per ft³");
  });

  it("6. Invoice Detail & Print: correctly renders ft³ and vehicle category for new invoices and m³ for historical invoices", async () => {
    // New ft³ Invoice
    const newInvoice: InvoiceDetail = {
      id: 101,
      invoiceNumber: "NPR-INV-000101",
      customerId: 5,
      customerName: "Sunil Silva",
      customerPhone: "0712345678",
      customerLocation: "Seenimodara",
      vehicleCategory: "TRACTOR",
      unitSnapshot: "ft³",
      hasTransport: false,
      transportFee: "0.00",
      subtotal: "4500.00",
      grandTotal: "4500.00",
      effectiveGrandTotal: "4500.00",
      paidAmount: "4500.00",
      balanceDue: "0.00",
      paymentStatus: "PAID",
      invoiceStatus: "ISSUED",
      issuedByUserId: "c-1",
      issuedByName: "Nimal",
      issuedAt: "2026-11-23T08:00:00.000Z",
      businessDate: "2026-11-23",
      items: [
        {
          id: 1,
          materialId: 1,
          materialName: "3/4 Metal",
          quantity: "100.000",
          unitPrice: "45.00",
          lineTotal: "4500.00",
          unitSnapshot: "ft³",
          vehicleCategorySnapshot: "TRACTOR",
        },
      ],
      payments: [],
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
              initialInvoice: newInvoice,
              onBack: () => {},
            })
          )
        )
      );
    });
    await act(async () => {
      await flush();
    });

    const newInvoiceText = container.textContent ?? "";
    assert.match(newInvoiceText, /Tractor Rate/);
    assert.match(newInvoiceText, /100\.000 ft³/);
    assert.match(newInvoiceText, /Qty \/ ප්‍රමාණය \(ft³\)/); // A5 print header
    assert.match(newInvoiceText, /100\.000 ft³ × Rs\./); // Thermal 80mm material line

    // Unmount and render historical m³ invoice
    await act(async () => {
      root?.unmount();
      root = null;
    });

    const legacyInvoice: InvoiceDetail = {
      id: 5,
      invoiceNumber: "NPR-INV-000005",
      customerId: 2,
      customerName: "Old Customer",
      customerPhone: "0770000000",
      customerLocation: "Kurunegala",
      vehicleCategory: null,
      unitSnapshot: "m³",
      hasTransport: false,
      transportFee: "0.00",
      subtotal: "24000.00",
      grandTotal: "24000.00",
      effectiveGrandTotal: "24000.00",
      paidAmount: "24000.00",
      balanceDue: "0.00",
      paymentStatus: "PAID",
      invoiceStatus: "ISSUED",
      issuedByUserId: "c-1",
      issuedByName: "Nimal",
      issuedAt: "2026-11-10T10:00:00.000Z",
      businessDate: "2026-11-10",
      items: [
        {
          id: 1,
          materialId: 1,
          materialName: "3/4 Metal",
          quantity: "2.000",
          unitPrice: "12000.00",
          lineTotal: "24000.00",
          unitSnapshot: "m³",
          vehicleCategorySnapshot: null,
        },
      ],
      payments: [],
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
              initialInvoice: legacyInvoice,
              onBack: () => {},
            })
          )
        )
      );
    });
    await act(async () => {
      await flush();
    });

    const legacyInvoiceText = container.textContent ?? "";
    assert.doesNotMatch(legacyInvoiceText, /Tractor Rate/);
    assert.match(legacyInvoiceText, /2\.000 m³/);
    assert.match(legacyInvoiceText, /Qty \/ ප්‍රමාණය \(m³\)/); // Preserves m³ on A5 print
    assert.match(legacyInvoiceText, /2\.000 m³ × Rs\./); // Preserves m³ on Thermal print
  });

  it("7. Phase 5 — 80mm thermal receipt simplified, clean layout, large typography, bilingual labels & exact 2-decimal formatting", async () => {
    const multiItemInvoice: InvoiceDetail = {
      id: 99,
      invoiceNumber: "NPR-INV-000099",
      customerId: 12,
      customerName: "Liyanage Construction & Engineering (Pvt) Ltd",
      customerPhone: "0779998877",
      customerLocation: "Industrial Zone, Matara Road, Seenimodara",
      vehicleCategory: "TRACTOR",
      unitSnapshot: "ft³",
      hasTransport: true,
      transportFee: "3500.00",
      subtotal: "37500.00",
      grandTotal: "41000.00",
      effectiveGrandTotal: "41000.00",
      paidAmount: "15000.00",
      balanceDue: "26000.00",
      paymentStatus: "PARTIALLY_PAID",
      invoiceStatus: "ISSUED",
      issuedByUserId: "c-1",
      issuedByName: "Bandara",
      issuedAt: "2026-11-23T10:30:00.000Z",
      businessDate: "2026-11-23",
      items: [
        {
          id: 1,
          materialId: 1,
          materialName: "3/4 Metal Premium Coarse Aggregate",
          quantity: "100.000",
          unitPrice: "250.00",
          lineTotal: "25000.00",
          unitSnapshot: "ft³",
          vehicleCategorySnapshot: "TRACTOR",
        },
        {
          id: 2,
          materialId: 2,
          materialName: "Quarry Dust Filling",
          quantity: "50.000",
          unitPrice: "250.00",
          lineTotal: "12500.00",
          unitSnapshot: "ft³",
          vehicleCategorySnapshot: "TRACTOR",
        },
      ],
      payments: [
        {
          id: 1,
          receiptNumber: "NPR-RCP-000201",
          invoiceId: 99,
          cashierUserId: "c-1",
          cashierName: "Bandara",
          paymentMethod: "CASH",
          amount: "15000.00",
          notes: null,
          createdAt: "2026-11-23T10:35:00.000Z",
        },
      ],
    };

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(InvoicePrintThermal80, { invoice: multiItemInvoice })
      );
    });
    await act(async () => {
      await flush();
    });

    const receipt = container.querySelector(".thermal-receipt-container");
    assert.ok(receipt, "Expected .thermal-receipt-container element");
    const receiptText = receipt.textContent ?? "";

    // 1. Workshop Details at the top
    assert.match(receiptText, /N\. P\. R\. METAL CRUSHER/);
    assert.match(receiptText, /Seenimodara/);
    assert.match(receiptText, /071 4470495/);
    assert.match(receiptText, /077 6159861/);
    assert.match(receiptText, /047 3129921/);
    assert.match(receiptText, /Reg No:\s*H\/6\/3134/);

    // 2. Customer Section
    assert.match(receiptText, /Customer \/ පාරිභෝගිකයා:/);
    assert.match(receiptText, /Liyanage Construction & Engineering \(Pvt\) Ltd/);
    assert.match(receiptText, /Location \/ ස්ථානය:/);
    assert.match(receiptText, /Industrial Zone, Matara Road, Seenimodara/);
    assert.match(receiptText, /T\.P \/ දුරකථන:/);
    assert.match(receiptText, /0779998877/);

    // 3. Date and Time Section
    assert.match(receiptText, /Invoice \/ බිල්පත:\s*NPR-INV-000099/);
    assert.match(receiptText, /Date \/ දිනය:/);
    assert.match(receiptText, /Time \/ වේලාව:/);

    // 4. Material Section (Name, Qty, Price per ft³, Line Total)
    assert.match(receiptText, /3\/4 Metal Premium Coarse Aggregate/);
    assert.match(receiptText, /100\.000 ft³ × Rs\. 250\.00/);
    assert.match(receiptText, /Rs\. 25,000\.00/);
    assert.match(receiptText, /Quarry Dust Filling/);
    assert.match(receiptText, /50\.000 ft³ × Rs\. 250\.00/);
    assert.match(receiptText, /Rs\. 12,500\.00/);

    // 5. Transport Section
    assert.match(receiptText, /Transport \/ ප්‍රවාහන:\s*Rs\. 3,500\.00/);

    // 6. Payment Summary (Total, Paid amount, Balance, Status)
    assert.match(receiptText, /Total \/ එකතුව:\s*Rs\. 41,000\.00/);
    assert.match(receiptText, /Paid \/ ගෙවූ මුදල:\s*Rs\. 15,000\.00/);
    assert.match(receiptText, /Balance \/ ඉතිරිය:\s*Rs\. 26,000\.00/);
    assert.match(receiptText, /Status \/ තත්ත්වය:\s*PARTIAL \/ කොටසක් ගෙවා ඇත/);

    // 7. Footer
    assert.match(receiptText, /Thank You!/);
    assert.match(receiptText, /ස්තූතියි!/);

    // 8. CRITICAL SIMPLIFICATION VERIFICATION: No vehicle type & no excessive metadata
    assert.doesNotMatch(receiptText, /TRACTOR/);
    assert.doesNotMatch(receiptText, /TIPPER/);
    assert.doesNotMatch(receiptText, /Rate Category/);
    assert.doesNotMatch(receiptText, /Proprietor/);
    assert.doesNotMatch(receiptText, /Cashier/);
    assert.doesNotMatch(receiptText, /Subtotal/);
    assert.doesNotMatch(receiptText, /Payments Received/);
    assert.doesNotMatch(receiptText, /NPR-RCP/);
    assert.doesNotMatch(receiptText, /Commercial terms/);
    assert.doesNotMatch(receiptText, /END OF RECEIPT/);

    // 9. Large font size & typography structure verification
    const headerTitle = receipt.querySelector("h1");
    assert.ok(headerTitle?.className.includes("text-[20px]"), "Header should use ~20px font");
    assert.ok(headerTitle?.className.includes("font-semibold"), "Header company name should be font-semibold, not heavy bold");
    assert.ok(receipt.className.includes("text-[16px]"), "Body container must use text-[16px]");
    assert.ok(receipt.className.includes("font-normal"), "Body container must use font-normal (400)");
  });
});
