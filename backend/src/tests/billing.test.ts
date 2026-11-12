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

describe("Billing MVP — Real PostgreSQL 17 + npr_app_user Integration Tests", () => {
  const suffix = randomUUID().slice(0, 8);
  const ownerUsername = `bill_owner_${suffix}`;
  const cashierUsername = `bill_cashier_${suffix}`;
  const pwd = "BillingTestPwd!2026";

  let server: Server;
  let baseUrl = "";
  let ownerCookie = "";
  let cashierCookie = "";
  let materialIds: Record<string, number> = {};

  before(async () => {
    const dbCheck = await adminPool.query<{ db: string }>("SELECT current_database() AS db");
    assert.equal(dbCheck.rows[0]?.db, "npr_test_db");

    const hash = await hashPassword(pwd);
    await adminPool.query(
      `INSERT INTO public.users (username, password_hash, full_name, role, is_active)
       VALUES ($1, $2, 'Billing Test Owner', 'OWNER', true),
              ($3, $2, 'Billing Test Cashier', 'CASHIER', true)`,
      [ownerUsername, hash, cashierUsername]
    );

    // Ensure the 4 Sri Lankan quarry materials exist in isolated test DB
    for (const mat of [
      { code: `MAT34_${suffix}`, name: '3/4"', price: "12000.00" },
      { code: `MATDUST_${suffix}`, name: "Dust", price: "8500.50" },
      { code: `MAT69_${suffix}`, name: "6×9", price: "10250.00" },
      { code: `MATABC_${suffix}`, name: "ABC", price: "11000.00" },
    ]) {
      const inserted = await adminPool.query<{ id: number }>(
        `INSERT INTO public.materials (code, name, unit, current_unit_price, is_active)
         VALUES ($1, $2, 'm³', $3, true)
         RETURNING id`,
        [mat.code, mat.name, mat.price]
      );
      materialIds[mat.name] = inserted.rows[0].id;
    }

    const appUrl = new URL(TEST_URL);
    appUrl.username = "npr_app_user";
    appUrl.password = process.env.TEST_APP_USER_PASSWORD ?? "test_only_app_password_2b2";
    appUserPool = new Pool({ connectionString: appUrl.toString(), max: 8 });

    const app = createApp({ pool: appUserPool, securityConfig: buildConfig() });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Forwarded-For": "203.0.113.10",
      },
      body: JSON.stringify({ username: ownerUsername, password: pwd }),
    });
    assert.equal(ownerLogin.status, 200);
    ownerCookie = extractCookie(ownerLogin.headers.get("set-cookie"));

    const cashierLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Forwarded-For": "203.0.113.11",
      },
      body: JSON.stringify({ username: cashierUsername, password: pwd }),
    });
    assert.equal(cashierLogin.status, 200);
    cashierCookie = extractCookie(cashierLogin.headers.get("set-cookie"));
    assert.ok(cashierCookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await appUserPool.end();
    await adminPool.end();
  });

  it("rejects unauthenticated access and blocks CASHIER from OWNER reports endpoint", async () => {
    assert.equal((await fetch(`${baseUrl}/api/materials`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/invoices`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/reports/overview`)).status, 401);

    const cashierOverview = await fetch(`${baseUrl}/api/reports/overview`, {
      headers: { Cookie: cashierCookie },
    });
    assert.equal(cashierOverview.status, 403);

    const ownerOverview = await fetch(`${baseUrl}/api/reports/overview`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(ownerOverview.status, 200);
  });

  it("creates customers, issues multi-item invoice with exact decimal math, preserves price snapshot, and prevents duplicates", async () => {
    // 1. Load real materials from DB
    const matsRes = await fetch(`${baseUrl}/api/materials`, {
      headers: { Cookie: cashierCookie },
    });
    assert.equal(matsRes.status, 200);
    const matsJson = (await matsRes.json()) as {
      data: { materials: Array<{ id: number; name: string; currentUnitPrice: string }> };
    };
    assert.ok(matsJson.data.materials.length >= 4);

    // 2. Create and search customer
    const custRes = await fetch(`${baseUrl}/api/customers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        name: `Lanka Builders_${suffix}`,
        phone: "0771234567",
        location: "Dambulla Road, Kurunegala",
      }),
    });
    assert.equal(custRes.status, 201);
    const createdCust = ((await custRes.json()) as { data: { customer: { id: number } } }).data
      .customer;

    const searchRes = await fetch(
      `${baseUrl}/api/customers?q=${encodeURIComponent(`Builders_${suffix}`)}`,
      { headers: { Cookie: cashierCookie } }
    );
    assert.equal(searchRes.status, 200);
    const searchJson = (await searchRes.json()) as {
      data: { customers: Array<{ id: number }> };
    };
    assert.equal(searchJson.data.customers[0].id, createdCust.id);

    // 3. Reject inconsistent transport fee when hasTransport is false
    const badTransport = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        customerId: createdCust.id,
        items: [{ materialId: materialIds['3/4"'], quantity: "2.000" }],
        hasTransport: false,
        transportFee: "5000.00",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(badTransport.status, 400);

    // 4. Issue multi-item invoice with partial initial payment
    //    2.500 * 12000.00 = 30000.00
    //    1.125 * 8500.50  =  9563.0625 -> rounds to 9563.06
    //    Subtotal         = 39563.06
    //    Transport        =  7500.00
    //    Grand Total      = 47063.06
    //    Initial Paid     = 20000.00 -> Balance Due = 27063.06
    const idemKey = randomUUID();
    const issuePayload = {
      customerId: createdCust.id,
      items: [
        { materialId: materialIds['3/4"'], quantity: "2.5" },
        { materialId: materialIds["Dust"], quantity: "1.125" },
      ],
      hasTransport: true,
      transportFee: "7500.00",
      initialPaymentAmount: "20000.00",
      idempotencyKey: idemKey,
    };

    const issueRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify(issuePayload),
    });
    assert.equal(issueRes.status, 201);
    const issueJson = (await issueRes.json()) as {
      data: {
        replayed: boolean;
        invoice: {
          id: number;
          invoiceNumber: string;
          subtotal: string;
          grandTotal: string;
          paidAmount: string;
          balanceDue: string;
          paymentStatus: string;
          items: Array<{ unitPrice: string; lineTotal: string }>;
          payments: Array<{ receiptNumber: string; amount: string }>;
        };
      };
    };

    const inv = issueJson.data.invoice;
    assert.equal(issueJson.data.replayed, false);
    assert.match(inv.invoiceNumber, /^NPR-INV-\d{6,}$/);
    assert.equal(inv.subtotal, "39563.06");
    assert.equal(inv.grandTotal, "47063.06");
    assert.equal(inv.paidAmount, "20000.00");
    assert.equal(inv.balanceDue, "27063.06");
    assert.equal(inv.paymentStatus, "PARTIALLY_PAID");
    assert.equal(inv.items.length, 2);
    assert.equal(inv.payments.length, 1);
    assert.match(inv.payments[0].receiptNumber, /^NPR-REC-\d{6,}$/);

    // 5. Retry exact same idempotencyKey -> replays existing invoice cleanly without duplicating
    const replayRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify(issuePayload),
    });
    assert.equal(replayRes.status, 201);
    const replayJson = (await replayRes.json()) as typeof issueJson;
    assert.equal(replayJson.data.replayed, true);
    assert.equal(replayJson.data.invoice.id, inv.id);

    // 6. Conflicting payload with same idempotencyKey returns 409
    const conflictRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({ ...issuePayload, transportFee: "1000.00" }),
    });
    assert.equal(conflictRes.status, 409);

    // 7. Changing active material price afterward preserves historical snapshot on issued invoice
    await adminPool.query(
      "UPDATE public.materials SET current_unit_price = 99999.00 WHERE id = $1",
      [materialIds['3/4"']]
    );
    const reloadRes = await fetch(`${baseUrl}/api/invoices/${inv.id}`, {
      headers: { Cookie: cashierCookie },
    });
    assert.equal(reloadRes.status, 200);
    const reloaded = ((await reloadRes.json()) as { data: { invoice: typeof inv } }).data.invoice;
    assert.equal(reloaded.items[0].unitPrice, "12000.00");
    assert.equal(reloaded.grandTotal, "47063.06");

    // 8. Issued invoice commercial immutability enforced by DB triggers even under runtime role
    await assert.rejects(() =>
      appUserPool.query(
        "UPDATE public.invoices SET grand_total = 1.00 WHERE id = $1",
        [inv.id]
      )
    );
  });

  it("handles subsequent partial/full payments, prevents overpayment and concurrent races, and surfaces real totals to Owner", async () => {
    // Issue an unpaid invoice for Rs. 10,250.00 (1.000 m³ of 6x9, no transport)
    const invRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        customer: {
          name: `Concurrent Customer ${suffix}`,
          phone: "0719876543",
          location: "Mawathagama",
        },
        items: [{ materialId: materialIds["6×9"], quantity: "1.000" }],
        hasTransport: false,
        transportFee: "0.00",
        initialPaymentAmount: "0.00",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(invRes.status, 201);
    const inv = ((await invRes.json()) as {
      data: { invoice: { id: number; grandTotal: string; balanceDue: string; paymentStatus: string } };
    }).data.invoice;
    assert.equal(inv.grandTotal, "10250.00");
    assert.equal(inv.balanceDue, "10250.00");
    assert.equal(inv.paymentStatus, "UNPAID");

    // Negative and zero payments rejected
    for (const badAmount of ["0.00", "-500.00", "10250.01"]) {
      const badPay = await fetch(`${baseUrl}/api/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: cashierCookie,
        },
        body: JSON.stringify({
          invoiceId: inv.id,
          amount: badAmount,
          idempotencyKey: randomUUID(),
        }),
      });
      assert.equal(badPay.status, 400);
    }

    // Concurrent partial payments racing for remaining Rs. 10,250.00 (2 requests of Rs. 6,000.00 each)
    const [race1, race2] = await Promise.all([
      fetch(`${baseUrl}/api/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: cashierCookie,
        },
        body: JSON.stringify({
          invoiceId: inv.id,
          amount: "6000.00",
          idempotencyKey: randomUUID(),
        }),
      }),
      fetch(`${baseUrl}/api/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: cashierCookie,
        },
        body: JSON.stringify({
          invoiceId: inv.id,
          amount: "6000.00",
          idempotencyKey: randomUUID(),
        }),
      }),
    ]);

    const statuses = [race1.status, race2.status].sort();
    assert.deepEqual(statuses, [201, 400]);

    // Pay exact remaining Rs. 4,250.00
    const finalPayKey = randomUUID();
    const finalPay = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        invoiceId: inv.id,
        amount: "4250.00",
        idempotencyKey: finalPayKey,
      }),
    });
    assert.equal(finalPay.status, 201);
    const finalPayJson = (await finalPay.json()) as {
      data: {
        invoice: { balanceDue: string; paidAmount: string; paymentStatus: string; payments: unknown[] };
      };
    };
    assert.equal(finalPayJson.data.invoice.paidAmount, "10250.00");
    assert.equal(finalPayJson.data.invoice.balanceDue, "0.00");
    assert.equal(finalPayJson.data.invoice.paymentStatus, "PAID");
    assert.equal(finalPayJson.data.invoice.payments.length, 2);

    // Owner history and overview reflect real totals cleanly
    const ownerListRes = await fetch(`${baseUrl}/api/invoices`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(ownerListRes.status, 200);
    const ownerList = ((await ownerListRes.json()) as {
      data: { invoices: Array<{ id: number; paymentStatus: string }> };
    }).data.invoices;
    assert.equal(ownerList.some((x) => x.id === inv.id && x.paymentStatus === "PAID"), true);

    const overviewRes = await fetch(`${baseUrl}/api/reports/overview`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(overviewRes.status, 200);
    const overview = ((await overviewRes.json()) as {
      data: {
        overview: {
          todayInvoiceCount: number;
          todayBilledTotal: string;
          todayCashCollected: string;
          totalOutstandingBalance: string;
        };
      };
    }).data.overview;
    assert.ok(overview.todayInvoiceCount >= 2);
    assert.equal(overview.todayCashCollected, "30250.00");
    assert.equal(overview.totalOutstandingBalance, "27063.06");
  });
});
