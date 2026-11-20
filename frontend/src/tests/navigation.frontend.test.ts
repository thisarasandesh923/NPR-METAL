import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testDom } from "./domSetup.ts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App, { AuthenticatedAppShell } from "../App.tsx";
import { LanguageProvider } from "../i18n/LanguageContext.tsx";
import {
  clearSavedNavigation,
  getSavedNavigation,
  NAV_STORAGE_KEY,
  saveNavigation,
} from "../features/auth/authNavigation.ts";
import { AuthProvider, useAuth } from "../context/AuthContext.tsx";
import type { AuthUser } from "../types/auth.ts";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const mockOwner: AuthUser = {
  id: "10000000-0000-0000-0000-000000000001",
  username: "rohan_owner",
  fullName: "Rohan Wijeratne",
  role: "OWNER",
};

const mockCashier: AuthUser = {
  id: "20000000-0000-0000-0000-000000000002",
  username: "nadeesha_cashier",
  fullName: "Nadeesha Perera",
  role: "CASHIER",
};

describe("Navigation State Persistence & Session Refresh Protection", () => {
  let container: HTMLElement;
  let root: Root | null = null;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    testDom.window.localStorage.clear();
    testDom.window.sessionStorage.clear();
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
    testDom.window.sessionStorage.clear();
  });

  function installMockFetch(activeUser: AuthUser | null): void {
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        if (!activeUser) {
          return jsonResponse(401, {
            success: false,
            error: { code: "UNAUTHORIZED", message: "No session" },
          });
        }
        return jsonResponse(200, { success: true, data: { user: activeUser } });
      }

      if (url === "/api/auth/logout") {
        return jsonResponse(200, { success: true, data: { loggedOut: true } });
      }

      if (url === "/api/reports/overview") {
        return jsonResponse(200, {
          success: true,
          data: {
            overview: {
              todaySalesTotal: "0.00",
              todayInvoiceCount: 0,
              monthSalesTotal: "0.00",
              outstandingTotal: "0.00",
              recentInvoices: [],
            },
          },
        });
      }

      if (url === "/api/materials" || url === "/api/materials?includeInactive=true") {
        return jsonResponse(200, { success: true, data: { materials: [] } });
      }

      if (url.startsWith("/api/workers")) {
        return jsonResponse(200, { success: true, data: { workers: [] } });
      }

      if (url.startsWith("/api/payroll/advances")) {
        return jsonResponse(200, { success: true, data: { advances: [] } });
      }

      if (url.startsWith("/api/payroll/payments")) {
        return jsonResponse(200, { success: true, data: { payments: [] } });
      }

      if (url.startsWith("/api/expenses")) {
        return jsonResponse(200, { success: true, data: { expenses: [] } });
      }

      if (url.startsWith("/api/payroll/periods")) {
        return jsonResponse(200, { success: true, data: { periods: [], entries: [] } });
      }

      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }

      if (url.startsWith("/api/approvals")) {
        return jsonResponse(200, {
          success: true,
          data: { pending: { priceChanges: [], manualSalaries: [], shiftLogs: [] } },
        });
      }

      return jsonResponse(200, { success: true, data: {} });
    }) as typeof globalThis.fetch;
  }

  async function renderElement(element: React.ReactElement): Promise<void> {
    root = createRoot(container);
    await act(async () => {
      root!.render(element);
    });
    await act(async () => {
      await flushMicrotasks();
    });
  }

  // ---------------------------------------------------------------------------
  // UNIT TESTS: Storage Scoping & Safety Rules
  // ---------------------------------------------------------------------------
  it("saves and restores navigation state scoped to user ID and role", () => {
    // 1. Save valid owner navigation to payroll
    saveNavigation(mockOwner, "payroll");
    const stored = getSavedNavigation(mockOwner);
    assert.deepEqual(stored, { screen: "payroll" });

    // 2. Reject saved state when queried by a different user ID
    const differentUser = { ...mockOwner, id: "99999999-9999-9999-9999-999999999999" };
    assert.equal(getSavedNavigation(differentUser), null);

    // 3. Reject saved state when role changes
    const roleChanged = { ...mockOwner, role: "CASHIER" as const };
    assert.equal(getSavedNavigation(roleChanged), null);

    // 4. Default dashboard is not stored in sessionStorage to keep storage clean
    saveNavigation(mockOwner, "owner-dashboard");
    assert.equal(testDom.window.sessionStorage.getItem(NAV_STORAGE_KEY), null);
    assert.equal(getSavedNavigation(mockOwner), null);
  });

  it("safely resolves invoice-detail with positive invoiceId or falls back to invoices list", () => {
    // Valid invoiceId is preserved
    saveNavigation(mockOwner, "invoice-detail", 42);
    assert.deepEqual(getSavedNavigation(mockOwner), {
      screen: "invoice-detail",
      selectedInvoiceId: 42,
    });

    // Missing / invalid invoiceId gracefully falls back to invoices list
    testDom.window.sessionStorage.setItem(
      NAV_STORAGE_KEY,
      JSON.stringify({
        userId: mockOwner.id,
        role: mockOwner.role,
        screen: "invoice-detail",
        selectedInvoiceId: null,
      })
    );
    assert.deepEqual(getSavedNavigation(mockOwner), { screen: "invoices" });

    // Negative invoiceId falls back to invoices list
    testDom.window.sessionStorage.setItem(
      NAV_STORAGE_KEY,
      JSON.stringify({
        userId: mockOwner.id,
        role: mockOwner.role,
        screen: "invoice-detail",
        selectedInvoiceId: -1,
      })
    );
    assert.deepEqual(getSavedNavigation(mockOwner), { screen: "invoices" });
  });

  it("prevents role bypass through sessionStorage tampering", () => {
    // Cashier attempts to store Owner-only approvals screen
    testDom.window.sessionStorage.setItem(
      NAV_STORAGE_KEY,
      JSON.stringify({
        userId: mockCashier.id,
        role: mockCashier.role,
        screen: "approvals",
      })
    );
    // getSavedNavigation validates through resolveAuthorizedScreen and returns role default
    assert.deepEqual(getSavedNavigation(mockCashier), {
      screen: "cashier-dashboard",
    });
  });

  it("clears saved navigation on clearSavedNavigation()", () => {
    saveNavigation(mockOwner, "payroll");
    assert.notEqual(testDom.window.sessionStorage.getItem(NAV_STORAGE_KEY), null);

    clearSavedNavigation();
    assert.equal(testDom.window.sessionStorage.getItem(NAV_STORAGE_KEY), null);
    assert.equal(getSavedNavigation(mockOwner), null);
  });

  // ---------------------------------------------------------------------------
  // INTEGRATION TESTS: F5 Browser Reload Simulation
  // ---------------------------------------------------------------------------
  it("Owner: restores Payroll tab across browser reload (F5)", async () => {
    installMockFetch(mockOwner);

    // Initial mount: User starts on Owner Dashboard
    await renderElement(React.createElement(App));
    assert.match(container.textContent ?? "", /Owner Management Portal/);

    // Owner navigates to Payroll via Sidebar
    const navButtons = Array.from(container.querySelectorAll("nav button"));
    const payrollBtn = navButtons.find((btn) => /Payroll/i.test(btn.textContent ?? ""));
    assert.ok(payrollBtn, "Payroll button should be present in sidebar");

    await act(async () => {
      payrollBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
      await flushMicrotasks();
    });

    // Verify Payroll screen is active and stored
    assert.match(container.textContent ?? "", /Salary Periods/);
    const stored = getSavedNavigation(mockOwner);
    assert.equal(stored?.screen, "payroll");

    // SIMULATE F5 / BROWSER RELOAD: unmount and mount new App instance with existing sessionStorage
    await act(async () => {
      root?.unmount();
      root = null;
    });

    // Remount App (simulates F5 reload)
    await renderElement(React.createElement(App));

    // Verify it restores directly to Payroll, NOT Dashboard!
    assert.match(container.textContent ?? "", /Salary Periods/);
    assert.doesNotMatch(container.textContent ?? "", /Search All Invoices/);
  });

  it("Owner: restores Invoices tab across browser reload (F5)", async () => {
    installMockFetch(mockOwner);

    // Pre-populate sessionStorage as if Owner was on invoices tab before pressing F5
    saveNavigation(mockOwner, "invoices");

    // Mount App (simulates reload on Invoices tab)
    await renderElement(React.createElement(App));

    // Verify Invoices page renders
    assert.match(container.textContent ?? "", /Invoice History/);
    assert.doesNotMatch(container.textContent ?? "", /Owner Management Portal/);
  });

  it("Owner: restores Daily Operations tab across browser reload (F5)", async () => {
    installMockFetch(mockOwner);

    // Pre-populate sessionStorage as if Owner was on daily-operations tab before pressing F5
    saveNavigation(mockOwner, "daily-operations");

    // Mount App (simulates reload on Daily Operations tab)
    await renderElement(React.createElement(App));

    assert.match(container.textContent ?? "", /Daily Operations/);
    assert.doesNotMatch(container.textContent ?? "", /Owner Management Portal/);
  });

  it("Cashier: restores New Invoice (Billing) tab across browser reload (F5)", async () => {
    installMockFetch(mockCashier);

    // Initial mount on Cashier Dashboard
    await renderElement(React.createElement(App));
    assert.match(container.textContent ?? "", /(?:Cashier Dashboard|මුදල් අයකැමි පුවරුව)/);

    // Cashier navigates to New Invoice
    const newInvoiceBtn = Array.from(container.querySelectorAll("nav button")).find(
      (btn) => /(?:New Invoice|නව බිල්පත)/i.test(btn.textContent ?? "")
    );
    assert.ok(newInvoiceBtn, "New Invoice nav button should be present");

    await act(async () => {
      newInvoiceBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
      await flushMicrotasks();
    });

    // Verify New Invoice page is active and saved
    assert.match(container.textContent ?? "", /(?:Customer Details|පාරිභෝගික විස්තර)/);
    assert.equal(getSavedNavigation(mockCashier)?.screen, "new-invoice");

    // SIMULATE F5 / BROWSER RELOAD
    await act(async () => {
      root?.unmount();
      root = null;
    });

    await renderElement(React.createElement(App));

    // Verify New Invoice is restored
    assert.match(container.textContent ?? "", /(?:Customer Details|පාරිභෝගික විස්තර)/);
    assert.doesNotMatch(container.textContent ?? "", /(?:Cashier Dashboard|මුදල් අයකැමි පුවරුව)/);
  });

  it("Cashier: restores Payroll tab across browser reload (F5)", async () => {
    installMockFetch(mockCashier);

    // Pre-populate sessionStorage with Cashier on payroll
    saveNavigation(mockCashier, "payroll");

    await renderElement(React.createElement(App));

    // Cashier sees Payroll in Sinhala / English
    assert.match(container.textContent ?? "", /(?:Salary Periods|වැටුප් කාලසීමා)/);
    assert.doesNotMatch(container.textContent ?? "", /(?:Cashier Dashboard|මුදල් අයකැමි පුවරුව)/);
  });

  // ---------------------------------------------------------------------------
  // INTEGRATION TESTS: Session Refresh / Window Focus Does NOT Reset State
  // ---------------------------------------------------------------------------
  it("preserves active screen during session refresh and window focus revalidation", async () => {
    installMockFetch(mockOwner);

    // Initial mount
    let authContextRef: ReturnType<typeof useAuth> | null = null;
    function TestHook() {
      authContextRef = useAuth();
      return null;
    }

    function TestApp() {
      return React.createElement(
        AuthProvider,
        null,
        React.createElement(
          LanguageProvider,
          null,
          React.createElement(TestHook),
          React.createElement(AuthenticatedAppShell)
        )
      );
    }

    await renderElement(React.createElement(TestApp));

    // Navigate to Payroll
    const navButtons = Array.from(container.querySelectorAll("nav button"));
    const payrollBtn = navButtons.find((btn) => /Payroll/i.test(btn.textContent ?? ""));
    assert.ok(payrollBtn);

    await act(async () => {
      payrollBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
      await flushMicrotasks();
    });

    assert.match(container.textContent ?? "", /Salary Periods/);

    // Trigger refreshSession() (e.g. window focus revalidation after 30 seconds)
    // This creates a fresh user object reference from the API
    assert.ok(authContextRef);
    await act(async () => {
      await (authContextRef as any).refreshSession();
      await flushMicrotasks();
    });

    // CRITICAL ASSERTION: The screen MUST remain on Payroll and NOT reset to Dashboard!
    assert.match(
      container.textContent ?? "",
      /Salary Periods/,
      "Screen must remain on Payroll after refreshSession()"
    );
    assert.doesNotMatch(
      container.textContent ?? "",
      /Search All Invoices/,
      "Screen must NOT reset to Owner Dashboard on session revalidation"
    );
  });

  // ---------------------------------------------------------------------------
  // SECURITY & LIFECYCLE TESTS: Logout & Cross-User Isolation
  // ---------------------------------------------------------------------------
  it("logout clears saved navigation state and subsequent login starts at Dashboard", async () => {
    let currentUser: AuthUser | null = mockOwner;
    installMockFetch(currentUser);

    await renderElement(React.createElement(App));

    // Navigate to Payroll
    const navButtons = Array.from(container.querySelectorAll("nav button"));
    const payrollBtn = navButtons.find((btn) => /Payroll/i.test(btn.textContent ?? ""));
    await act(async () => {
      payrollBtn!.dispatchEvent(new window.Event("click", { bubbles: true }));
      await flushMicrotasks();
    });
    assert.match(container.textContent ?? "", /Salary Periods/);
    assert.notEqual(testDom.window.sessionStorage.getItem(NAV_STORAGE_KEY), null);

    // Click Sign Out / Logout button
    const logoutBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      /(?:Logout|Sign Out|ඉවත් වන්න)/i.test(btn.textContent ?? "")
    );
    assert.ok(logoutBtn, "Logout button must be present");

    currentUser = null;
    installMockFetch(null);

    await act(async () => {
      logoutBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
      await flushMicrotasks();
    });

    // Verified: sessionStorage navigation state is wiped on logout
    assert.equal(
      testDom.window.sessionStorage.getItem(NAV_STORAGE_KEY),
      null,
      "sessionStorage must be cleared on logout"
    );

    // Returns to Landing Page
    assert.match(container.textContent ?? "", /NPR METAL CRUSHER/);

    // Now a fresh login occurs for Cashier
    currentUser = mockCashier;
    installMockFetch(mockCashier);

    // Remount App with newly logged-in cashier
    await act(async () => {
      root?.unmount();
      root = null;
    });

    await renderElement(React.createElement(App));

    // Must start on Cashier Dashboard, NOT previous Owner's Payroll!
    assert.match(container.textContent ?? "", /(?:Cashier Dashboard|මුදල් අයකැමි පුවරුව)/);
    assert.doesNotMatch(container.textContent ?? "", /Salary Periods/);
  });
});
