import { testDom } from "./domSetup.ts";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OwnerApprovalsPage } from "../features/approvals/OwnerApprovalsPage.tsx";
import { ErrorBoundary } from "../components/ui/ErrorBoundary.tsx";
import { fetchPendingApprovals } from "../api/operations.ts";

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("Owner Approvals Queue — Runtime Crash Fix & Edge Case Regression Tests", () => {
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

  it("regression: correctly extracts data.pending from backend response avoiding undefined .length crash", async () => {
    // The exact response shape sent by backend router:
    // res.status(200).json({ success: true, data: { pending: { attendance, machineLogs, productionLogs, totalCount } } })
    const backendPayload = {
      success: true,
      data: {
        pending: {
          attendance: [],
          machineLogs: [],
          productionLogs: [],
          totalCount: 0,
        },
      },
    };

    globalThis.fetch = (async (url: string) => {
      if (url === "/api/approvals/pending") {
        return jsonResponse(200, backendPayload);
      }
      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    // Verify fetchPendingApprovals extracts attendance, machineLogs, productionLogs
    const result = await fetchPendingApprovals();
    assert.ok(Array.isArray(result.attendance), "attendance must be an array");
    assert.ok(Array.isArray(result.machineLogs), "machineLogs must be an array");
    assert.ok(Array.isArray(result.productionLogs), "productionLogs must be an array");

    // Mount OwnerApprovalsPage
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OwnerApprovalsPage));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const text = container.textContent ?? "";
    assert.match(text, /Pending Approvals \(0\)/);
    assert.match(text, /All Caught Up/);
    assert.match(
      text,
      /Zero pending attendance, machine, or production submissions await your approval\./
    );
  });

  it("handles missing or malformed pending approvals payload gracefully without throwing", async () => {
    // Malformed: pending object missing arrays or containing non-array fields
    globalThis.fetch = (async (url: string) => {
      if (url === "/api/approvals/pending") {
        return jsonResponse(200, {
          success: true,
          data: {
            pending: {
              attendance: null,
              machineLogs: undefined,
              // productionLogs omitted
            },
          },
        });
      }
      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    const result = await fetchPendingApprovals();
    assert.equal(result.attendance.length, 0);
    assert.equal(result.machineLogs.length, 0);
    assert.equal(result.productionLogs.length, 0);

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OwnerApprovalsPage));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const text = container.textContent ?? "";
    assert.match(text, /Pending Approvals \(0\)/);
    assert.match(text, /All Caught Up/);
  });

  it("renders pending submissions across all three categories when data is present", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url === "/api/approvals/pending") {
        return jsonResponse(200, {
          success: true,
          data: {
            pending: {
              attendance: [
                {
                  id: 101,
                  workerId: 1,
                  workerCode: "W01",
                  workerName: "Kamal Perera",
                  workDate: "2026-11-15",
                  startTime: "08:00",
                  endTime: "17:00",
                  breakMinutes: 60,
                  crossesMidnight: false,
                  hoursWorked: "8.00",
                  overtimeHours: "0.00",
                  enteredByName: "Cashier One",
                  approvalStatus: "SUBMITTED",
                  version: 1,
                  remarks: "Shift completed",
                },
              ],
              machineLogs: [
                {
                  id: 201,
                  machineId: 2,
                  machineCode: "CR01",
                  machineName: "Jaw Crusher Primary",
                  workDate: "2026-11-15",
                  startTime: "08:00",
                  endTime: "16:00",
                  downtimeMinutes: 30,
                  netOperatingHours: "7.50",
                  enteredByName: "Cashier One",
                  approvalStatus: "SUBMITTED",
                  version: 1,
                  operatorWorkerName: "Sunil",
                },
              ],
              productionLogs: [
                {
                  id: 301,
                  materialId: 1,
                  materialCode: "3/4",
                  materialName: '3/4" Metal',
                  productionDate: "2026-11-15",
                  quantityProduced: "25.000",
                  enteredByName: "Cashier One",
                  approvalStatus: "SUBMITTED",
                  version: 1,
                },
              ],
              totalCount: 3,
            },
          },
        });
      }
      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OwnerApprovalsPage));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const text = container.textContent ?? "";
    assert.match(text, /Pending Approvals \(3\)/);
    assert.match(text, /Worker Attendance \(1\)/);
    assert.match(text, /Kamal Perera/);
    assert.match(text, /Machine Operating Logs \(1\)/);
    assert.match(text, /Jaw Crusher Primary/);
    assert.match(text, /Crushed Metal Production \(1\)/);
    assert.match(text, /25\.000 m³/);

    // Verify Action buttons
    const approveBtns = container.querySelectorAll("button");
    const approveBtnList = Array.from(approveBtns).filter((b) =>
      b.textContent?.includes("Approve")
    );
    assert.equal(approveBtnList.length, 3, "Expected 3 Approve buttons");
  });

  it("does not mask backend failures by showing 'All Caught Up' when API call fails", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url === "/api/approvals/pending") {
        return jsonResponse(500, {
          success: false,
          error: { code: "SERVER_ERROR", message: "Database connection failed." },
        });
      }
      return jsonResponse(404, { success: false });
    }) as typeof fetch;

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OwnerApprovalsPage));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const text = container.textContent ?? "";
    // MUST NOT show "All Caught Up"
    assert.doesNotMatch(text, /All Caught Up/);
    // MUST show failure message and Retry option
    assert.match(text, /Failed to Load Approvals Queue/);
    assert.match(text, /Database connection failed\./);

    const retryBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Retry")
    );
    assert.ok(retryBtn, "Expected Retry Connection button on failed load");
  });

  it("ErrorBoundary prevents full application white-screen when a component crashes", async () => {
    function BrokenComponent(): React.ReactElement {
      throw new Error("Simulated render crash inside broken page");
    }

    // Suppress console.error during this intentional error test
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      await act(async () => {
        root = createRoot(container);
        root.render(
          React.createElement(
            ErrorBoundary,
            { fallbackTitle: "Approvals Queue Error" },
            React.createElement(BrokenComponent)
          )
        );
        await flushMicrotasks();
      });

      const text = container.textContent ?? "";
      assert.match(text, /Approvals Queue Error/);
      assert.match(text, /Simulated render crash inside broken page/);
      assert.match(text, /Try Again/);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
