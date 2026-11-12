import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { createApp } from "../app.js";
import type { SecurityConfig } from "../config/securityConfig.js";
import { SESSION_COOKIE_NAME } from "../modules/auth/cookies.js";
import { hashPassword } from "../modules/auth/password.js";

const { Pool } = pg;

function getVerifiedLocalTestUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error("SAFETY ABORT: TEST_DATABASE_URL is not set.");
  }
  if (testUrl.toLowerCase().includes("supabase")) {
    throw new Error("SAFETY ABORT: TEST_DATABASE_URL references Supabase.");
  }
  const parsed = new URL(testUrl);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("SAFETY ABORT: Host must be local.");
  }
  if (parsed.port !== "55432" || parsed.pathname !== "/npr_test_db") {
    throw new Error("SAFETY ABORT: Target must be 127.0.0.1:55432/npr_test_db.");
  }
  return testUrl;
}

const TEST_URL = getVerifiedLocalTestUrl();
const adminPool = new Pool({ connectionString: TEST_URL, max: 4 });
let appUserPool: pg.Pool;

function extractCookie(setCookieHeader: string | null): string {
  assert.ok(setCookieHeader, "Expected Set-Cookie header");
  return setCookieHeader.split(";")[0];
}

function buildConfig(): SecurityConfig {
  return {
    isProduction: false,
    allowedOrigins: new Set(["http://localhost:5173"]),
    cookieSecure: false,
    trustProxy: 1,
    sessionIdleTtlMs: 30 * 60 * 1000,
    sessionMaxLifetimeMs: 12 * 60 * 60 * 1000,
    sessionRenewThresholdMs: 15 * 60 * 1000,
    loginRateLimitMaxFailures: 5,
    loginRateLimitWindowMs: 15 * 60 * 1000,
  };
}

describe("Operations, Approvals, Payroll, Reports & Payment Adjustments — PG 17 + npr_app_user", () => {
  const suffix = randomUUID().slice(0, 8);
  const ownerUsername = `ops_owner_${suffix}`;
  const cashierUsername = `ops_cashier_${suffix}`;
  const pwd = "OpsPayrollTestPwd!2026";

  let server: Server;
  let baseUrl = "";
  let ownerCookie = "";
  let cashierCookie = "";
  let materialId = 0;
  let hourlyWorkerId = 0;
  let manualWorkerId = 0;
  let machineId = 0;
  let paymentId = 0;
  let invoiceId = 0;

  before(async () => {
    const dbCheck = await adminPool.query<{ db: string }>("SELECT current_database() AS db");
    assert.equal(dbCheck.rows[0]?.db, "npr_test_db");

    const hash = await hashPassword(pwd);
    await adminPool.query(
      `INSERT INTO public.users (username, password_hash, full_name, role, is_active)
       VALUES ($1, $2, 'Ops Test Owner', 'OWNER', true),
              ($3, $2, 'Ops Test Cashier', 'CASHIER', true)`,
      [ownerUsername, hash, cashierUsername]
    );

    const matRes = await adminPool.query<{ id: number }>(
      `INSERT INTO public.materials (code, name, unit, current_unit_price, is_active)
       VALUES ($1, $2, 'm³', 12000.00, true)
       RETURNING id`,
      [`OPS34_${suffix}`, `3/4" Aggregate ${suffix}`]
    );
    materialId = matRes.rows[0].id;

    const appUrl = new URL(TEST_URL);
    appUrl.username = "npr_app_user";
    appUrl.password = process.env.TEST_APP_USER_PASSWORD ?? "test_only_app_password_2b2";
    appUserPool = new Pool({ connectionString: appUrl.toString(), max: 10 });

    const app = createApp({ pool: appUserPool, securityConfig: buildConfig() });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: ownerUsername, password: pwd }),
    });
    assert.equal(ownerLogin.status, 200);
    ownerCookie = extractCookie(ownerLogin.headers.get("set-cookie"));
    assert.ok(ownerCookie.startsWith(`${SESSION_COOKIE_NAME}=`));

    const cashierLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: cashierUsername, password: pwd }),
    });
    assert.equal(cashierLogin.status, 200);
    cashierCookie = extractCookie(cashierLogin.headers.get("set-cookie"));
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await appUserPool.end();
    await adminPool.end();
  });

  async function api(
    cookie: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        "X-Requested-With": "XMLHttpRequest",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  it("enforces Owner-only material price updates with snapshot preservation and version locking", async () => {
    const invRes = await api(cashierCookie, "POST", "/api/invoices", {
      customer: {
        name: "Colombo Builders",
        phone: "0771112233",
        location: "Kadawatha",
      },
      items: [{ materialId, quantity: "2.000" }],
      hasTransport: false,
      transportFee: "0.00",
      initialPaymentAmount: "10000.00",
      idempotencyKey: `inv-${randomUUID()}`,
    });
    assert.equal(invRes.status, 201);
    const invData = (await invRes.json()) as {
      data: { invoice: { id: number; grandTotal: string; payments: Array<{ id: number }> } };
    };
    invoiceId = invData.data.invoice.id;
    paymentId = invData.data.invoice.payments[0].id;
    assert.equal(invData.data.invoice.grandTotal, "24000.00");

    // Cashier is denied updating material prices
    const denied = await api(cashierCookie, "PUT", `/api/materials/${materialId}/price`, {
      newPrice: "13000.00",
      reason: "Unauthorized price bump attempt",
      expectedVersion: 1,
    });
    assert.equal(denied.status, 403);

    // Owner updates price
    const ok = await api(ownerCookie, "PUT", `/api/materials/${materialId}/price`, {
      newPrice: "13500.00",
      reason: "Quarry diesel & transport rate increase",
      expectedVersion: 1,
    });
    assert.equal(ok.status, 200);
    const okJson = (await ok.json()) as {
      data: { material: { currentUnitPrice: string; version: number } };
    };
    assert.equal(okJson.data.material.currentUnitPrice, "13500.00");
    assert.equal(okJson.data.material.version, 2);

    // Stale optimistic lock rejected
    const stale = await api(ownerCookie, "PUT", `/api/materials/${materialId}/price`, {
      newPrice: "14000.00",
      reason: "Stale concurrent edit test",
      expectedVersion: 1,
    });
    assert.equal(stale.status, 409);

    // Price history visible to Owner
    const histRes = await api(
      ownerCookie,
      "GET",
      `/api/materials/price-history?materialId=${materialId}`
    );
    assert.equal(histRes.status, 200);
    const histJson = (await histRes.json()) as {
      data: { history: Array<{ newPrice: string }> };
    };
    assert.ok(histJson.data.history.some((h) => h.newPrice === "13500.00"));

    // Historical invoice stays pinned at Rs. 24,000.00
    const reloadedInv = await api(cashierCookie, "GET", `/api/invoices/${invoiceId}`);
    assert.equal(reloadedInv.status, 200);
    const reloadedJson = (await reloadedInv.json()) as {
      data: { invoice: { grandTotal: string } };
    };
    assert.equal(reloadedJson.data.invoice.grandTotal, "24000.00");
  });

  it("manages workers, machines, overlaps, overnight logs, production m3, and approval lifecycle", async () => {
    const deniedWorker = await api(cashierCookie, "POST", "/api/workers", {
      workerCode: `W1-${suffix}`,
      fullName: "Unauthorized Worker",
      designation: "Helper",
    });
    assert.equal(deniedWorker.status, 403);

    const w1Res = await api(ownerCookie, "POST", "/api/workers", {
      workerCode: `WH-${suffix}`,
      fullName: "Nimal Perera",
      phone: "0779001122",
      designation: "Primary Crusher Operator",
      joinedDate: "2025-01-15",
    });
    assert.equal(w1Res.status, 201);
    hourlyWorkerId = ((await w1Res.json()) as { data: { worker: { id: number } } }).data.worker.id;

    const w2Res = await api(ownerCookie, "POST", "/api/workers", {
      workerCode: `WM-${suffix}`,
      fullName: "Sunil Bandara",
      designation: "Loader Helper",
    });
    assert.equal(w2Res.status, 201);
    manualWorkerId = ((await w2Res.json()) as { data: { worker: { id: number } } }).data.worker.id;

    const mRes = await api(ownerCookie, "POST", "/api/machines", {
      machineCode: `JAW-${suffix}`,
      machineName: "Jaw Crusher 01",
      machineType: "CRUSHER",
    });
    assert.equal(mRes.status, 201);
    machineId = ((await mRes.json()) as { data: { machine: { id: number } } }).data.machine.id;

    // Cashier logs overnight shift Draft (22:00 -> 06:00 next day, 30 min break = 7.50h)
    const a1Res = await api(cashierCookie, "POST", "/api/attendance", {
      workDate: "2026-11-10",
      workerId: hourlyWorkerId,
      startTime: "22:00",
      endTime: "06:00",
      crossesMidnight: true,
      breakMinutes: 30,
      overtimeHours: "1.50",
      remarks: "Night crushing run",
    });
    assert.equal(a1Res.status, 201);
    const a1 = ((await a1Res.json()) as {
      data: { attendance: { id: number; hoursWorked: string; version: number } };
    }).data.attendance;
    assert.equal(a1.hoursWorked, "7.50");

    // Overlapping morning shift on 2026-11-11 (05:00 -> 12:00) MUST reject
    const overlapRes = await api(cashierCookie, "POST", "/api/attendance", {
      workDate: "2026-11-11",
      workerId: hourlyWorkerId,
      startTime: "05:00",
      endTime: "12:00",
      crossesMidnight: false,
      breakMinutes: 0,
    });
    assert.equal(overlapRes.status, 409);

    // Invalid downtime > span rejected for machine log
    const badMachine = await api(cashierCookie, "POST", "/api/machine-logs", {
      workDate: "2026-11-10",
      machineId,
      startTime: "08:00",
      endTime: "10:00",
      downtimeMinutes: 150,
    });
    assert.equal(badMachine.status, 400);

    const machRes = await api(cashierCookie, "POST", "/api/machine-logs", {
      workDate: "2026-11-10",
      machineId,
      operatorWorkerId: hourlyWorkerId,
      startTime: "08:00",
      endTime: "17:00",
      downtimeMinutes: 60,
      downtimeReason: "Belt tensioning",
      scheduledHours: "9.00",
    });
    assert.equal(machRes.status, 201);
    const machLog = ((await machRes.json()) as {
      data: { machineLog: { id: number; netOperatingHours: string; utilizationPercent: string; version: number } };
    }).data.machineLog;
    assert.equal(machLog.netOperatingHours, "8.00");
    assert.equal(machLog.utilizationPercent, "88.9");

    // Production m3 log (precise to 3 decimals)
    const prodRes = await api(cashierCookie, "POST", "/api/production", {
      productionDate: "2026-11-10",
      materialId,
      machineId,
      operatorWorkerId: hourlyWorkerId,
      shiftLabel: "Day Shift",
      quantityProduced: "42.375",
    });
    assert.equal(prodRes.status, 201);
    const prodLog = ((await prodRes.json()) as {
      data: { productionLog: { id: number; quantityProduced: string; version: number } };
    }).data.productionLog;
    assert.equal(prodLog.quantityProduced, "42.375");

    // Cashier submits all 3 drafts
    assert.equal(
      (await api(cashierCookie, "POST", `/api/attendance/${a1.id}/submit`, { expectedVersion: a1.version })).status,
      200
    );
    assert.equal(
      (await api(cashierCookie, "POST", `/api/machine-logs/${machLog.id}/submit`, { expectedVersion: machLog.version })).status,
      200
    );
    assert.equal(
      (await api(cashierCookie, "POST", `/api/production/${prodLog.id}/submit`, { expectedVersion: prodLog.version })).status,
      200
    );

    // Cashier cannot approve/review
    assert.equal(
      (
        await api(cashierCookie, "POST", `/api/attendance/${a1.id}/review`, {
          decision: "APPROVED",
          expectedVersion: a1.version + 1,
        })
      ).status,
      403
    );

    // Owner returns attendance without reason -> 400
    assert.equal(
      (
        await api(ownerCookie, "POST", `/api/attendance/${a1.id}/review`, {
          decision: "RETURNED_FOR_CORRECTION",
          expectedVersion: a1.version + 1,
        })
      ).status,
      400
    );

    // Owner returns attendance with valid reason -> version bumps
    const retRes = await api(ownerCookie, "POST", `/api/attendance/${a1.id}/review`, {
      decision: "RETURNED_FOR_CORRECTION",
      reason: "Please verify overtime hours as 1.00 instead of 1.50.",
      expectedVersion: a1.version + 1,
    });
    assert.equal(retRes.status, 200);

    // Cashier edits returned record & resubmits
    const editRes = await api(cashierCookie, "PUT", `/api/attendance/${a1.id}`, {
      workDate: "2026-11-10",
      workerId: hourlyWorkerId,
      startTime: "22:00",
      endTime: "06:00",
      crossesMidnight: true,
      breakMinutes: 30,
      overtimeHours: "1.00",
      expectedVersion: a1.version + 2,
    });
    assert.equal(editRes.status, 200);
    assert.equal(
      (await api(cashierCookie, "POST", `/api/attendance/${a1.id}/submit`, { expectedVersion: a1.version + 3 })).status,
      200
    );

    // Owner approves attendance, machine log, and production log
    const attAppRes = await api(ownerCookie, "POST", `/api/attendance/${a1.id}/review`, {
      decision: "APPROVED",
      expectedVersion: a1.version + 4,
    });
    assert.equal(attAppRes.status, 200);

    // Duplicate concurrent approval with stale version rejected
    const attDupRes = await api(ownerCookie, "POST", `/api/attendance/${a1.id}/review`, {
      decision: "APPROVED",
      expectedVersion: a1.version + 4,
    });
    assert.equal(attDupRes.status, 409);

    assert.equal(
      (
        await api(ownerCookie, "POST", `/api/machine-logs/${machLog.id}/review`, {
          decision: "APPROVED",
          expectedVersion: machLog.version + 1,
        })
      ).status,
      200
    );
    assert.equal(
      (
        await api(ownerCookie, "POST", `/api/production/${prodLog.id}/review`, {
          decision: "APPROVED",
          expectedVersion: prodLog.version + 1,
        })
      ).status,
      200
    );

    // Approved attendance is immutable
    const editApproved = await api(cashierCookie, "PUT", `/api/attendance/${a1.id}`, {
      workDate: "2026-11-10",
      workerId: hourlyWorkerId,
      startTime: "22:00",
      endTime: "06:00",
      crossesMidnight: true,
      breakMinutes: 30,
      expectedVersion: a1.version + 5,
    });
    assert.equal(editApproved.status, 409);
  });

  it("strictly isolates Payroll, Expenses, Reports & Payment Adjustments to OWNER", async () => {
    for (const [method, path] of [
      ["GET", "/api/payroll/compensation"],
      ["GET", "/api/payroll/periods"],
      ["GET", "/api/payroll/advances"],
      ["GET", "/api/payroll/payments"],
      ["GET", "/api/expenses"],
      ["GET", "/api/approvals/pending"],
      ["GET", "/api/reports/overview"],
      ["GET", "/api/reports/financial"],
      ["GET", "/api/reports/operations"],
      ["GET", "/api/reports/export?type=summary&format=csv"],
      ["GET", "/api/reports/export/payroll?format=csv"],
    ]) {
      const r = await api(cashierCookie, method, path);
      assert.equal(r.status, 403, `Expected 403 for CASHIER on ${method} ${path}`);
    }

    // Configure HOURLY profile for hourlyWorkerId; leave manualWorkerId as MANUAL
    assert.equal(
      (
        await api(ownerCookie, "PUT", "/api/payroll/compensation", {
          workerId: hourlyWorkerId,
          payArrangement: "HOURLY",
          baseRate: "600.00",
          overtimeHourlyRate: "900.00",
          effectiveFrom: "2026-11-01",
        })
      ).status,
      200
    );

    // Record an advance for Nimal
    const advRes = await api(ownerCookie, "POST", "/api/payroll/advances", {
      workerId: hourlyWorkerId,
      advanceDate: "2026-11-10",
      amount: "1000.00",
      reason: "Festival salary advance",
      idempotencyKey: `adv-${randomUUID()}`,
    });
    assert.equal(advRes.status, 201);

    // Record operational expense
    const expRes = await api(ownerCookie, "POST", "/api/expenses", {
      expenseDate: "2026-11-10",
      category: "FUEL",
      amount: "18500.00",
      description: "Crusher generator diesel refill",
      idempotencyKey: `exp-${randomUUID()}`,
    });
    assert.equal(expRes.status, 201);

    // Create payroll period 2026-11-01 .. 2026-11-15
    const perRes = await api(ownerCookie, "POST", "/api/payroll/periods", {
      periodLabel: `Nov 1-15 ${suffix}`,
      startDate: "2026-11-01",
      endDate: "2026-11-15",
    });
    assert.equal(perRes.status, 201);
    const periodId = ((await perRes.json()) as { data: { period: { id: number } } }).data.period.id;

    // Prepare drafts: Nimal auto-calculated (6.50 regular hrs * 600 + 1.00 OT hr * 900 - 1000 adv = 3900 + 900 - 1000 = 3800)
    const prepRes = await api(ownerCookie, "POST", `/api/payroll/periods/${periodId}/prepare`);
    assert.equal(prepRes.status, 200);
    const entries = ((await prepRes.json()) as {
      data: {
        entries: Array<{
          id: number;
          workerId: number;
          calculationMode: string;
          basePay: string;
          overtimePay: string;
          grossPay: string;
          netPayable: string;
          version: number;
        }>;
      };
    }).data.entries;

    const nimal = entries.find((e) => e.workerId === hourlyWorkerId)!;
    const sunil = entries.find((e) => e.workerId === manualWorkerId)!;
    assert.equal(nimal.calculationMode, "CONFIGURED_AUTO");
    assert.equal(nimal.basePay, "3900.00");
    assert.equal(nimal.overtimePay, "900.00");
    assert.equal(nimal.netPayable, "3800.00");
    assert.equal(sunil.calculationMode, "OWNER_MANUAL_DRAFT");
    assert.equal(sunil.netPayable, "0.00");

    // Approve Nimal's payroll entry
    const appEntry = await api(ownerCookie, "POST", `/api/payroll/entries/${nimal.id}/approve`, {
      expectedVersion: nimal.version,
    });
    assert.equal(appEntry.status, 200);

    // Overpayment > Rs. 3,800.00 rejected
    const overPay = await api(ownerCookie, "POST", `/api/payroll/entries/${nimal.id}/payments`, {
      paymentDate: "2026-11-12",
      amount: "3900.00",
      paymentMethod: "CASH",
      idempotencyKey: `sal-o-${randomUUID()}`,
    });
    assert.equal(overPay.status, 400);

    // Exact Rs. 3,800.00 paid
    const salOk = await api(ownerCookie, "POST", `/api/payroll/entries/${nimal.id}/payments`, {
      paymentDate: "2026-11-12",
      amount: "3800.00",
      paymentMethod: "CASH",
      idempotencyKey: `sal-${randomUUID()}`,
    });
    assert.equal(salOk.status, 201);

    // Duplicate salary payment rejected once balance = 0
    const dupPay = await api(ownerCookie, "POST", `/api/payroll/entries/${nimal.id}/payments`, {
      paymentDate: "2026-11-12",
      amount: "100.00",
      paymentMethod: "CASH",
      idempotencyKey: `sal-d-${randomUUID()}`,
    });
    assert.equal(dupPay.status, 409);

    // Financial & Operations Reports + Exports
    const finRes = await api(
      ownerCookie,
      "GET",
      "/api/reports/financial?dateFrom=2026-11-01&dateTo=2026-11-30"
    );
    assert.equal(finRes.status, 200);
    const finJson = (await finRes.json()) as {
      data: { financial: { recordedExpensesTotal: string; payrollCashPaidTotal: string } };
    };
    assert.equal(finJson.data.financial.recordedExpensesTotal, "18500.00");
    assert.equal(finJson.data.financial.payrollCashPaidTotal, "3800.00");

    // General export rejects type=payroll
    const badPayrollExport = await api(
      ownerCookie,
      "GET",
      "/api/reports/export?type=payroll&format=csv"
    );
    assert.equal(badPayrollExport.status, 400);

    const xlsxRes = await api(
      ownerCookie,
      "GET",
      "/api/reports/export?type=production&format=xlsx&dateFrom=2026-11-01&dateTo=2026-11-30"
    );
    assert.equal(xlsxRes.status, 200);
    assert.equal(Buffer.from(await xlsxRes.arrayBuffer()).subarray(0, 2).toString("utf8"), "PK");

    const pdfRes = await api(
      ownerCookie,
      "GET",
      `/api/reports/export/payroll?format=pdf&periodId=${periodId}`
    );
    assert.equal(pdfRes.status, 200);
    assert.equal(Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 5).toString("utf8"), "%PDF-");

    // Owner Payment ENTRY_REVERSAL adjustment (Cashier denied, Owner reverses Rs. 2,500 of Rs. 10,000)
    const cashierAdj = await api(cashierCookie, "POST", `/api/payments/${paymentId}/adjust`, {
      adjustmentType: "ENTRY_REVERSAL",
      amount: "2500.00",
      reason: "Unauthorized reversal attempt",
      idempotencyKey: `adj-c-${randomUUID()}`,
    });
    assert.equal(cashierAdj.status, 403);

    const ownerAdj = await api(ownerCookie, "POST", `/api/payments/${paymentId}/adjust`, {
      adjustmentType: "ENTRY_REVERSAL",
      amount: "2500.00",
      reason: "Cashier entered Rs. 10,000 instead of Rs. 7,500 received.",
      idempotencyKey: `adj-o-${randomUUID()}`,
    });
    assert.equal(ownerAdj.status, 201);
    const adjJson = (await ownerAdj.json()) as {
      data: {
        invoice: { paidAmount: string; balanceDue: string; adjustments: unknown[] };
      };
    };
    assert.equal(adjJson.data.invoice.paidAmount, "7500.00");
    assert.equal(adjJson.data.invoice.balanceDue, "16500.00");
    assert.equal(adjJson.data.invoice.adjustments.length, 1);

    // Over-reversal beyond remaining Rs. 7,500 fails
    const excessAdj = await api(ownerCookie, "POST", `/api/payments/${paymentId}/adjust`, {
      adjustmentType: "ENTRY_REVERSAL",
      amount: "8000.00",
      reason: "Excessive adjustment check must be blocked",
      idempotencyKey: `adj-x-${randomUUID()}`,
    });
    assert.equal(excessAdj.status, 400);
  });
});
