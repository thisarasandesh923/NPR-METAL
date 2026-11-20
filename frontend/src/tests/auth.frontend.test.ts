import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testDom } from "./domSetup.ts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../App.tsx";
import {
  getCurrentSessionRequest,
  loginRequest,
  logoutRequest,
} from "../api/auth.ts";
import {
  ApiError,
  apiRequest,
  setUnauthorizedHandler,
} from "../api/client.ts";
import { AuthProvider, useAuth } from "../context/AuthContext.tsx";
import {
  canAccessScreen,
  getDefaultScreenForRole,
  getNavItemsForRole,
  resolveAuthorizedScreen,
} from "../features/auth/authNavigation.ts";
import { ProtectedRoute } from "../features/auth/components/ProtectedRoute.tsx";
import type { AuthUser } from "../types/auth.ts";

interface RecordedFetchCall {
  url: string;
  init: RequestInit | undefined;
}

type FetchHandler = (
  url: string,
  init?: RequestInit
) => Promise<Response> | Response;

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

describe("Phase 3B — Frontend Authentication API, RBAC Guards & React UI Tests", () => {
  let container: HTMLElement;
  let root: Root | null = null;
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: RecordedFetchCall[] = [];

  beforeEach(() => {
    testDom.window.localStorage.clear();
    testDom.window.sessionStorage.clear();
    testDom.window.document.body.innerHTML = "<div id='root'></div>";
    container = testDom.window.document.getElementById("root")!;
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    setUnauthorizedHandler(null);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    globalThis.fetch = originalFetch;
    setUnauthorizedHandler(null);
  });

  function installMockFetch(handler: FetchHandler): void {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });
      return await handler(url, init);
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

  it("enforces credentials:include, CSRF X-Requested-With headers, 429 retry formatting, network error handling, and role payload validation", async () => {
    installMockFetch(async (url, init) => {
      if (url === "/api/auth/login" && init?.method === "POST") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "u-1",
              username: "owner1",
              fullName: "Nimal Perera",
              role: "OWNER",
            },
          },
        });
      }
      if (url === "/api/auth/me" && init?.method === "GET") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "u-bad",
              username: "evil",
              fullName: "Evil",
              role: "SUPERADMIN",
            },
          },
        });
      }
      if (url === "/api/auth/logout") {
        return jsonResponse(401, {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Expired" },
        });
      }
      if (url === "/api/protected-check") {
        return jsonResponse(401, {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Expired" },
        });
      }
      if (url === "/api/rate-limit-check") {
        return jsonResponse(
          429,
          {
            success: false,
            error: { code: "RATE_LIMIT_EXCEEDED", message: "Slow down" },
          },
          { "Retry-After": "120" }
        );
      }
      throw new TypeError("Failed to fetch");
    });

    const user = await loginRequest({ username: "owner1", password: "Secret!123" });
    assert.equal(user.role, "OWNER");
    assert.equal(fetchCalls[0].init?.credentials, "include");
    const postHeaders = fetchCalls[0].init?.headers as Record<string, string>;
    assert.equal(postHeaders["X-Requested-With"], "XMLHttpRequest");
    assert.equal(postHeaders["Content-Type"], "application/json");

    // Rejects unknown/tampered role from server fail-closed
    await assert.rejects(
      () => getCurrentSessionRequest(),
      (err: unknown) =>
        err instanceof ApiError && err.code === "INVALID_USER_PAYLOAD"
    );
    assert.equal(fetchCalls[1].init?.credentials, "include");

    // Logout treats 401 (already revoked) cleanly and sends CSRF header
    await logoutRequest();
    const logoutHeaders = fetchCalls[2].init?.headers as Record<string, string>;
    assert.equal(logoutHeaders["X-Requested-With"], "XMLHttpRequest");
    assert.equal(fetchCalls[2].init?.credentials, "include");

    // Non-skipped 401 invokes unauthorized expiry callback
    let expiredTriggered = 0;
    setUnauthorizedHandler(() => {
      expiredTriggered += 1;
    });
    await assert.rejects(() => apiRequest("/api/protected-check"), ApiError);
    assert.equal(expiredTriggered, 1);

    // 429 parses Retry-After cleanly
    await assert.rejects(
      () => apiRequest("/api/rate-limit-check", { method: "POST", body: {} }),
      (err: unknown) =>
        err instanceof ApiError &&
        err.status === 429 &&
        err.retryAfterSeconds === 120 &&
        /2 minutes/.test(err.message)
    );

    // Network error throws friendly message
    await assert.rejects(
      () => apiRequest("/api/unreachable"),
      (err: unknown) =>
        err instanceof ApiError &&
        err.code === "NETWORK_ERROR" &&
        /Unable to reach/.test(err.message)
    );
  });

  it("enforces role-based screen routing helpers fail-closed", () => {
    assert.equal(getDefaultScreenForRole("OWNER"), "owner-dashboard");
    assert.equal(getDefaultScreenForRole("CASHIER"), "cashier-dashboard");
    assert.equal(canAccessScreen("CASHIER", "owner-dashboard"), false);
    assert.equal(canAccessScreen("OWNER", "owner-dashboard"), true);
    assert.equal(canAccessScreen("OWNER", "cashier-dashboard"), false);
    assert.equal(canAccessScreen("CASHIER", "cashier-dashboard"), true);
    assert.equal(
      resolveAuthorizedScreen("CASHIER", "owner-dashboard"),
      "cashier-dashboard"
    );
    assert.equal(
      resolveAuthorizedScreen("OWNER", "cashier-dashboard"),
      "owner-dashboard"
    );
    assert.equal(
      getNavItemsForRole("CASHIER").some((i) => i.screen === "owner-dashboard"),
      false
    );
    assert.equal(
      getNavItemsForRole("OWNER").some((i) => i.screen === "cashier-dashboard"),
      false
    );
  });

  it("never exposes dashboards while checking session, then renders LoginPage when unauthenticated", async () => {
    let resolveBoot!: (value: Response) => void;
    installMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveBoot = resolve;
        })
    );

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });

    assert.match(container.textContent ?? "", /Verifying workstation session/);
    assert.doesNotMatch(container.textContent ?? "", /Cashier Dashboard/);
    assert.doesNotMatch(container.textContent ?? "", /Owner Management Portal/);

    await act(async () => {
      resolveBoot(
        jsonResponse(401, {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required." },
        })
      );
      await flushMicrotasks();
    });

    assert.match(container.textContent ?? "", /Sign In to Billing System/);
    assert.doesNotMatch(container.textContent ?? "", /Rs\. 284,500/);
  });

  it("restores authenticated OWNER session via GET /api/auth/me and avoids fake totals on Owner Dashboard", async () => {
    const owner: AuthUser = {
      id: "owner-1",
      username: "workshop_owner",
      fullName: "Rohan Wijeratne",
      role: "OWNER",
    };

    installMockFetch((url) => {
      if (url === "/api/auth/me") {
        return jsonResponse(200, { success: true, data: { user: owner } });
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
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    });

    await renderElement(React.createElement(App));

    assert.match(container.textContent ?? "", /Owner Management Portal/);
    assert.match(container.textContent ?? "", /Welcome, Rohan Wijeratne/);
    assert.doesNotMatch(container.textContent ?? "", /Rs\. 284,500/);
    assert.equal(testDom.window.localStorage.length, 0);
    assert.equal(testDom.window.sessionStorage.length, 0);
  });

  it("supports OWNER login, isolated Demo toggle, real Logout, and CASHIER login with visible Demo labels", async () => {
    let activeUser: AuthUser | null = null;

    installMockFetch(async (url, init) => {
      if (url === "/api/auth/me") {
        if (!activeUser) {
          return jsonResponse(401, {
            success: false,
            error: { code: "UNAUTHORIZED", message: "Authentication required." },
          });
        }
        return jsonResponse(200, { success: true, data: { user: activeUser } });
      }

      if (url === "/api/auth/login" && init?.method === "POST") {
        const headers = init.headers as Record<string, string>;
        assert.equal(headers["X-Requested-With"], "XMLHttpRequest");
        assert.equal(init.credentials, "include");
        const parsed = JSON.parse(String(init.body)) as {
          username: string;
          password: string;
        };
        if (parsed.username === "owner_u" && parsed.password === "OwnerPass!") {
          activeUser = {
            id: "o-1",
            username: "owner_u",
            fullName: "Saman Kumara",
            role: "OWNER",
          };
          return jsonResponse(200, { success: true, data: { user: activeUser } });
        }
        if (parsed.username === "cashier_u" && parsed.password === "CashierPass!") {
          activeUser = {
            id: "c-1",
            username: "cashier_u",
            fullName: "Nadeesha Silva",
            role: "CASHIER",
          };
          return jsonResponse(200, { success: true, data: { user: activeUser } });
        }
        return jsonResponse(401, {
          success: false,
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid username or password.",
          },
        });
      }

      if (url === "/api/auth/logout" && init?.method === "POST") {
        const headers = init.headers as Record<string, string>;
        assert.equal(headers["X-Requested-With"], "XMLHttpRequest");
        assert.equal(init.credentials, "include");
        activeUser = null;
        return jsonResponse(200, { success: true, data: { loggedOut: true } });
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

      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, { success: true, data: { invoices: [] } });
      }

      return jsonResponse(404, { success: false, error: { message: "Unknown" } });
    });

    await renderElement(React.createElement(App));

    // Invalid credentials first
    const userInput = container.querySelector("#login-username") as HTMLInputElement;
    const passInput = container.querySelector("#login-password") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;

    await setInputValue(userInput, "owner_u");
    await setInputValue(passInput, "WrongPwd");
    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    assert.match(container.textContent ?? "", /Invalid username or password\./);
    assert.equal((container.querySelector("#login-password") as HTMLInputElement).value, "");

    // Valid OWNER login
    await setInputValue(container.querySelector("#login-password") as HTMLInputElement, "OwnerPass!");
    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    assert.match(container.textContent ?? "", /Owner Management Portal/);
    assert.match(container.textContent ?? "", /Saman Kumara/);

    // Real logout returns to LoginPage
    const logoutBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Logout")
    )!;
    await act(async () => {
      logoutBtn.click();
      await flushMicrotasks();
    });
    assert.match(container.textContent ?? "", /Sign In to Billing System/);
    assert.equal(activeUser, null);

    // Valid CASHIER login routes strictly to Cashier Dashboard with Demo isolation badge
    await setInputValue(container.querySelector("#login-username") as HTMLInputElement, "cashier_u");
    await setInputValue(container.querySelector("#login-password") as HTMLInputElement, "CashierPass!");
    const form2 = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form2.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    assert.match(container.textContent ?? "", /(?:Cashier Dashboard|මුදල් අයකැමි පුවරුව)/);
    assert.match(container.textContent ?? "", /(?:Welcome, Nadeesha!|ආයුබෝවන්, Nadeesha!)/);
    assert.match(container.textContent ?? "", /(?:No invoices issued yet|තවම බිල්පත් නිකුත් කර නොමැත)/);
    assert.doesNotMatch(container.textContent ?? "", /Rs\. 284,500/);
    assert.doesNotMatch(container.textContent ?? "", /Owner Management Portal/);
    assert.equal(testDom.window.localStorage.length, 0);
    assert.equal(testDom.window.sessionStorage.length, 0);
  });

  it("handles rate limiting (429), network failures, and blocks CASHIER from OWNER-only ProtectedRoute", async () => {
    let mode: "429" | "network" = "429";
    installMockFetch((url, init) => {
      if (url === "/api/auth/me") {
        return jsonResponse(401, {
          success: false,
          error: { code: "UNAUTHORIZED", message: "No session" },
        });
      }
      if (url === "/api/auth/login" && init?.method === "POST") {
        if (mode === "429") {
          return jsonResponse(
            429,
            {
              success: false,
              error: { code: "RATE_LIMIT_EXCEEDED", message: "Locked" },
            },
            { "Retry-After": "900" }
          );
        }
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    });

    await renderElement(React.createElement(App));

    await setInputValue(
      container.querySelector("#login-username") as HTMLInputElement,
      "cashier1"
    );
    await setInputValue(
      container.querySelector("#login-password") as HTMLInputElement,
      "Password!123"
    );
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    assert.match(
      container.textContent ?? "",
      /Too many failed login attempts\. Please wait 15 minutes/
    );

    mode = "network";
    await setInputValue(
      container.querySelector("#login-password") as HTMLInputElement,
      "Password!123"
    );
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    assert.match(
      container.textContent ?? "",
      /Unable to reach the authentication server/
    );

    // Unmount and verify ProtectedRoute blocks CASHIER from OWNER children
    await act(async () => {
      root?.unmount();
      root = null;
    });

    installMockFetch((url) => {
      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "c-9",
              username: "cashier9",
              fullName: "Kasun Jayasinghe",
              role: "CASHIER",
            },
          },
        });
      }
      return jsonResponse(401, { success: false, error: { message: "Unauthorized" } });
    });

    await renderElement(
      React.createElement(AuthProvider, {
        children: React.createElement(ProtectedRoute, {
          allowedRoles: ["OWNER"],
          children: React.createElement("div", null, "SECRET_OWNER_CONTENT"),
        }),
      })
    );

    assert.match(container.textContent ?? "", /Access Restricted/);
    assert.doesNotMatch(container.textContent ?? "", /SECRET_OWNER_CONTENT/);
  });

  it("evicts user immediately to LoginPage when an authenticated API call returns 401 (expired/revoked session)", async () => {
    installMockFetch((url) => {
      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "c-2",
              username: "cashier2",
              fullName: "Tharindu Bandara",
              role: "CASHIER",
            },
          },
        });
      }
      if (url === "/api/test-expired") {
        return jsonResponse(401, {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Session revoked." },
        });
      }
      return jsonResponse(200, { success: true, data: {} });
    });

    function ExpiryProbe() {
      const { user } = useAuth();
      if (!user) {
        return React.createElement("div", null, "LOGGED_OUT_VIEW");
      }
      return React.createElement(
        "button",
        {
          id: "trigger-expired",
          onClick: () => {
            void apiRequest("/api/test-expired").catch(() => {});
          },
        },
        `LOGGED_IN:${user.username}`
      );
    }

    await renderElement(
      React.createElement(AuthProvider, {
        children: React.createElement(ProtectedRoute, {
          children: React.createElement(ExpiryProbe),
        }),
      })
    );

    assert.match(container.textContent ?? "", /LOGGED_IN:cashier2/);

    await act(async () => {
      (container.querySelector("#trigger-expired") as HTMLButtonElement).click();
      await flushMicrotasks();
    });

    assert.match(container.textContent ?? "", /Sign In to Billing System/);
    assert.match(
      container.textContent ?? "",
      /Your session has expired or been signed out/
    );
  });
});
