import { testDom } from "./domSetup.ts";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App.tsx";
import type { AuthUser } from "../types/auth.ts";

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

async function setInputValue(
  input: HTMLInputElement,
  value: string
): Promise<void> {
  await act(async () => {
    const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
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

describe("Landing Page & Dual Login Navigation — Frontend Tests", () => {
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
  });

  it("renders modern industrial landing page branded NPR Metal Crusher with real aggregate catalog", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url === "/api/auth/me") {
        return jsonResponse(401, { success: false, error: { message: "Unauthenticated" } });
      }
      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const text = container.textContent ?? "";

    // 1. Branding
    assert.match(text, /NPR METAL CRUSHER/);
    assert.match(text, /Seenimodara, Sri Lanka/);
    assert.match(text, /Nalaka Ranasinghe/);
    assert.match(text, /Billing & Workshop Management System/);

    // 2. Real Sri Lankan Aggregate Grades (no invented products)
    assert.match(text, /3\/4" Crushed Metal/);
    assert.match(text, /Quarry Dust/);
    assert.match(text, /6×9" Rubble/);
    assert.match(text, /Aggregate Base Coarse/);

    // 3. Two distinct action entry points exist
    assert.match(text, /Owner Login/);
    assert.match(text, /කැෂියර් පිවිසුම/);

    // 4. Verify absence of invented company addresses, phone numbers or fake statistics
    assert.doesNotMatch(text, /\+94/);
    assert.doesNotMatch(text, /info@/);
    assert.doesNotMatch(text, /happy customers/i);
    assert.doesNotMatch(text, /500,000 tons/i);
  });

  it("switches between Owner Login (English) and කැෂියර් පිවිසුම (Sinhala) entry points", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url === "/api/auth/me") {
        return jsonResponse(401, { success: false, error: { message: "Unauthenticated" } });
      }
      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const cashierTab = container.querySelector("#tab-cashier-login") as HTMLButtonElement;
    assert.ok(cashierTab, "Cashier tab must exist on landing page");

    // Click Cashier Portal tab
    await act(async () => {
      cashierTab.click();
      await flushMicrotasks();
    });

    let text = container.textContent ?? "";
    assert.match(text, /පරිශීලක නාමය/);
    assert.match(text, /මුරපදය/);
    assert.match(text, /කැෂියර් පිවිසුම/);

    // Click Owner Portal tab
    const ownerTab = container.querySelector("#tab-owner-login") as HTMLButtonElement;
    assert.ok(ownerTab, "Owner tab must exist on landing page");

    await act(async () => {
      ownerTab.click();
      await flushMicrotasks();
    });

    text = container.textContent ?? "";
    assert.match(text, /Username/);
    assert.match(text, /Password/);
    assert.match(text, /Sign In as Owner/);
  });

  it("authenticates Owner and routes strictly to Owner Dashboard, then returns to Landing Page on logout", async () => {
    let activeUser: AuthUser | null = null;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") {
        if (!activeUser) {
          return jsonResponse(401, { success: false, error: { message: "Unauthenticated" } });
        }
        return jsonResponse(200, { success: true, data: { user: activeUser } });
      }

      if (url === "/api/auth/login" && init?.method === "POST") {
        activeUser = {
          id: "o-99",
          username: "npr_owner",
          fullName: "Bandara Wijekoon",
          role: "OWNER",
        };
        return jsonResponse(200, { success: true, data: { user: activeUser } });
      }

      if (url === "/api/auth/logout" && init?.method === "POST") {
        activeUser = null;
        return jsonResponse(200, { success: true, data: { loggedOut: true } });
      }

      if (url === "/api/reports/overview") {
        return jsonResponse(200, {
          success: true,
          data: {
            overview: {
              businessDate: "2026-11-15",
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

      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }

      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    // Fill form and submit
    const userInput = container.querySelector("#login-username") as HTMLInputElement;
    const passInput = container.querySelector("#login-password") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;

    await setInputValue(userInput, "npr_owner");
    await setInputValue(passInput, "SecretPass!123");

    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    // Must route strictly to Owner Dashboard
    assert.match(container.textContent ?? "", /Owner Management Portal/);
    assert.match(container.textContent ?? "", /Bandara Wijekoon/);
    assert.doesNotMatch(container.textContent ?? "", /Cashier Dashboard/);

    // Logout
    const logoutBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Logout")
    )!;
    assert.ok(logoutBtn, "Logout button must exist in dashboard");

    await act(async () => {
      logoutBtn.click();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    // Returns to landing page
    assert.match(container.textContent ?? "", /NPR METAL CRUSHER/);
    assert.match(container.textContent ?? "", /Sign In to Billing System/);
    assert.match(container.textContent ?? "", /Owner Login/);
    assert.match(container.textContent ?? "", /කැෂියර් පිවිසුම/);
  });

  it("authenticates Cashier on Cashier Portal and routes strictly to Cashier Dashboard", async () => {
    let activeUser: AuthUser | null = null;
    let capturedBody: any = null;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") {
        if (!activeUser) {
          return jsonResponse(401, { success: false, error: { message: "Unauthenticated" } });
        }
        return jsonResponse(200, { success: true, data: { user: activeUser } });
      }

      if (url === "/api/auth/login" && init?.method === "POST") {
        capturedBody = JSON.parse(init.body as string);
        activeUser = {
          id: "c-11",
          username: "cashier_sarath",
          fullName: "Sarath Cashier",
          role: "CASHIER",
        };
        return jsonResponse(200, { success: true, data: { user: activeUser } });
      }

      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }

      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    // Switch to Cashier Tab
    const cashierTab = container.querySelector("#tab-cashier-login") as HTMLButtonElement;
    await act(async () => {
      cashierTab.click();
      await flushMicrotasks();
    });

    const userInput = container.querySelector("#login-username") as HTMLInputElement;
    const passInput = container.querySelector("#login-password") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;

    await setInputValue(userInput, "cashier_sarath");
    await setInputValue(passInput, "CashierSecret!2026");

    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    // Verify portal sent to backend
    assert.equal(capturedBody?.portal, "CASHIER");

    // Must route strictly to Cashier Dashboard (rendered in Sinhala/English for Cashier)
    const text = container.textContent ?? "";
    assert.match(text, /මුදල් අයකැමි|Cashier/);
    assert.match(text, /Sarath Cashier/);
    assert.doesNotMatch(text, /Owner Management Portal/);
  });

  it("rejects Owner credentials on Cashier Portal, displays safe error, and stays on Landing Page", async () => {
    let capturedBody: any = null;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") {
        return jsonResponse(401, { success: false, error: { message: "Unauthenticated" } });
      }

      if (url === "/api/auth/login" && init?.method === "POST") {
        capturedBody = JSON.parse(init.body as string);
        return jsonResponse(401, {
          success: false,
          error: {
            code: "CROSS_ROLE_LOGIN_FORBIDDEN",
            message: "Access denied. Only Cashier accounts can sign in through the Cashier Portal.",
          },
        });
      }

      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    // Switch to Cashier Tab
    const cashierTab = container.querySelector("#tab-cashier-login") as HTMLButtonElement;
    await act(async () => {
      cashierTab.click();
      await flushMicrotasks();
    });

    const userInput = container.querySelector("#login-username") as HTMLInputElement;
    const passInput = container.querySelector("#login-password") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;

    // Enter Owner credentials on Cashier tab
    await setInputValue(userInput, "npr_owner");
    await setInputValue(passInput, "OwnerSecret!2026");

    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    assert.equal(capturedBody?.portal, "CASHIER");

    // Error banner must be visible
    const alertBox = container.querySelector("[role='alert']");
    assert.ok(alertBox, "Alert box must be displayed");
    assert.match(alertBox.textContent ?? "", /Only Cashier accounts can sign in through the Cashier Portal/);

    // Must remain on Landing Page
    assert.match(container.textContent ?? "", /NPR METAL CRUSHER/);
    assert.doesNotMatch(container.textContent ?? "", /Cashier Dashboard/);
    assert.doesNotMatch(container.textContent ?? "", /Owner Management Portal/);
  });

  it("rejects Cashier credentials on Owner Portal, displays safe error, and stays on Landing Page", async () => {
    let capturedBody: any = null;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") {
        return jsonResponse(401, { success: false, error: { message: "Unauthenticated" } });
      }

      if (url === "/api/auth/login" && init?.method === "POST") {
        capturedBody = JSON.parse(init.body as string);
        return jsonResponse(401, {
          success: false,
          error: {
            code: "CROSS_ROLE_LOGIN_FORBIDDEN",
            message: "Access denied. Only Owner accounts can sign in through the Owner Portal.",
          },
        });
      }

      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(App));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    // Ensure on Owner tab
    const ownerTab = container.querySelector("#tab-owner-login") as HTMLButtonElement;
    await act(async () => {
      ownerTab.click();
      await flushMicrotasks();
    });

    const userInput = container.querySelector("#login-username") as HTMLInputElement;
    const passInput = container.querySelector("#login-password") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;

    // Enter Cashier credentials on Owner tab
    await setInputValue(userInput, "cashier_sarath");
    await setInputValue(passInput, "CashierSecret!2026");

    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    assert.equal(capturedBody?.portal, "OWNER");

    // Error banner must be visible
    const alertBox = container.querySelector("[role='alert']");
    assert.ok(alertBox, "Alert box must be displayed");
    assert.match(alertBox.textContent ?? "", /Only Owner accounts can sign in through the Owner Portal/);

    // Must remain on Landing Page
    assert.match(container.textContent ?? "", /NPR METAL CRUSHER/);
    assert.doesNotMatch(container.textContent ?? "", /Cashier Dashboard/);
    assert.doesNotMatch(container.textContent ?? "", /Owner Management Portal/);
  });
});
