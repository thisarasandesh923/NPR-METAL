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
    loginRateLimitMaxFailures: 20,
    loginRateLimitWindowMs: 15 * 60 * 1000,
  };
}

describe("Vehicle-Specific Material Pricing (ft³) — Real PostgreSQL 17 + npr_app_user Integration Tests", () => {
  const suffix = randomUUID().slice(0, 8);
  const ownerUsername = `veh_owner_${suffix}`;
  const cashierUsername = `veh_cashier_${suffix}`;
  const pwd = "VehPricingTestPwd!2026";

  let server: Server;
  let baseUrl = "";
  let ownerCookie = "";
  let cashierCookie = "";
  let ownerUserId = "";
  let cashierUserId = "";

  let mat34Id: number;
  let matDustId: number;
  let matUnconfiguredId: number;
  let customerId: number;

  before(async () => {
    // 1. Verify target database is isolated test DB
    const dbCheck = await adminPool.query<{ db: string }>("SELECT current_database() AS db");
    assert.equal(dbCheck.rows[0]?.db, "npr_test_db");

    // 2. Create test Owner and Cashier
    const hash = await hashPassword(pwd);
    const usersRes = await adminPool.query<{ id: string; role: string }>(
      `INSERT INTO public.users (username, password_hash, full_name, role, is_active)
       VALUES ($1, $2, 'Veh Test Owner', 'OWNER', true),
              ($3, $2, 'Veh Test Cashier', 'CASHIER', true)
       RETURNING id, role`,
      [ownerUsername, hash, cashierUsername]
    );
    for (const u of usersRes.rows) {
      if (u.role === "OWNER") ownerUserId = u.id;
      if (u.role === "CASHIER") cashierUserId = u.id;
    }

    // 3. Create test materials
    const m34Res = await adminPool.query<{ id: number }>(
      `INSERT INTO public.materials (code, name, unit, current_unit_price, is_active)
       VALUES ($1, '3/4 Metal', 'm³', 12000.00, true) RETURNING id`,
      [`MAT_34_${suffix}`]
    );
    mat34Id = m34Res.rows[0].id;

    const mDustRes = await adminPool.query<{ id: number }>(
      `INSERT INTO public.materials (code, name, unit, current_unit_price, is_active)
       VALUES ($1, 'Quarry Dust', 'm³', 8500.00, true) RETURNING id`,
      [`MAT_DUST_${suffix}`]
    );
    matDustId = mDustRes.rows[0].id;

    const mUnconfRes = await adminPool.query<{ id: number }>(
      `INSERT INTO public.materials (code, name, unit, current_unit_price, is_active)
       VALUES ($1, 'Unconfigured Aggregate', 'm³', 9500.00, true) RETURNING id`,
      [`MAT_UNCONF_${suffix}`]
    );
    matUnconfiguredId = mUnconfRes.rows[0].id;

    // 4. Configure vehicle-specific ft³ prices for 3/4 Metal and Dust
    // 3/4 Metal: TRACTOR = 45.00/ft³, TIPPER = 42.50/ft³
    await adminPool.query(
      `INSERT INTO public.material_vehicle_prices (material_id, vehicle_category, price_per_ft3, version)
       VALUES ($1, 'TRACTOR', 45.00, 1),
              ($1, 'TIPPER', 42.50, 1)`,
      [mat34Id]
    );

    // Dust: TRACTOR = 35.00/ft³, TIPPER = 32.00/ft³
    await adminPool.query(
      `INSERT INTO public.material_vehicle_prices (material_id, vehicle_category, price_per_ft3, version)
       VALUES ($1, 'TRACTOR', 35.00, 1),
              ($1, 'TIPPER', 32.00, 1)`,
      [matDustId]
    );

    // matUnconfiguredId has NO vehicle prices configured

    // 5. Create a shared test customer
    const custRes = await adminPool.query<{ id: string | number }>(
      `INSERT INTO public.customers (name, phone, location)
       VALUES ('NPR Test Customer', '0771234567', 'Kurunegala Site A')
       RETURNING id`
    );
    customerId = Number(custRes.rows[0].id);

    // 6. Connect as restricted runtime role npr_app_user
    const appUrl = new URL(TEST_URL);
    appUrl.username = "npr_app_user";
    appUrl.password = process.env.TEST_APP_USER_PASSWORD ?? "test_only_app_password_2b2";
    appUserPool = new Pool({ connectionString: appUrl.toString(), max: 8 });

    // 7. Start application server
    const app = createApp({ pool: appUserPool, securityConfig: buildConfig() });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // 8. Authenticate Owner and Cashier sessions
    const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 10}`,
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
        "X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 10}`,
      },
      body: JSON.stringify({ username: cashierUsername, password: pwd }),
    });
    assert.equal(cashierLogin.status, 200);
    cashierCookie = extractCookie(cashierLogin.headers.get("set-cookie"));
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (appUserPool) {
      await appUserPool.end();
    }
    if (adminPool) {
      await adminPool.end();
    }
  });

  // ---------------------------------------------------------------------------
  // Test 1: Active Materials List returns vehiclePrices for Tractor and Tipper
  // ---------------------------------------------------------------------------
  it("1. GET /api/materials returns independent TRACTOR and TIPPER ft³ prices per material", async () => {
    const res = await fetch(`${baseUrl}/api/materials`, {
      headers: { Cookie: cashierCookie },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      data: {
        materials: Array<{
          id: number;
          name: string;
          vehiclePrices?: {
            TRACTOR?: { pricePerFt3: string; version: number };
            TIPPER?: { pricePerFt3: string; version: number };
          };
        }>;
      };
    };

    const mat34 = json.data.materials.find((m) => m.id === mat34Id);
    assert.ok(mat34, "Expected 3/4 Metal in materials list");
    assert.ok(mat34.vehiclePrices, "Expected vehiclePrices on material");
    assert.equal(mat34.vehiclePrices.TRACTOR?.pricePerFt3, "45.00");
    assert.equal(mat34.vehiclePrices.TRACTOR?.version, 1);
    assert.equal(mat34.vehiclePrices.TIPPER?.pricePerFt3, "42.50");
    assert.equal(mat34.vehiclePrices.TIPPER?.version, 1);

    const matUnconf = json.data.materials.find((m) => m.id === matUnconfiguredId);
    assert.ok(matUnconf, "Expected Unconfigured material in list");
    assert.equal(matUnconf.vehiclePrices?.TRACTOR, null);
    assert.equal(matUnconf.vehiclePrices?.TIPPER, null);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Unconfigured vehicle price strictly blocks invoice creation
  // ---------------------------------------------------------------------------
  it("2. POST /api/invoices rejects issuance when vehicle price is unconfigured", async () => {
    const res = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        customerId,
        vehicleCategory: "TRACTOR",
        items: [{ materialId: matUnconfiguredId, quantity: "50.000" }],
        hasTransport: false,
        transportFee: "0.00",
        initialPaymentAmount: "0.00",
        idempotencyKey: randomUUID(),
      }),
    });

    assert.equal(res.status, 400);
    const err = (await res.json()) as { error: { message: string } };
    assert.match(err.error.message, /price configured for TRACTOR/i);

    // Verify zero invoices or items were created
    const countRes = await adminPool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM public.invoice_items WHERE material_id = $1",
      [matUnconfiguredId]
    );
    assert.equal(countRes.rows[0].count, "0");
  });

  // ---------------------------------------------------------------------------
  // Test 3: Authorized vehicle price updates with optimistic version locking
  // ---------------------------------------------------------------------------
  it("3. PUT /api/materials/:id/price supports Cashier & Owner updates and enforces version locking", async () => {
    // 3a. Cashier updates Tractor price for 3/4 Metal from 45.00 to 48.00 (expectedVersion: 1)
    const cashierUpdate = await fetch(
      `${baseUrl}/api/materials/${mat34Id}/price`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: cashierCookie,
        },
        body: JSON.stringify({
          vehicleCategory: "TRACTOR",
          newPrice: "48.00",
          reason: "Cashier adjusted tractor rate for quarry diesel bump",
          expectedVersion: 1,
        }),
      }
    );
    assert.equal(cashierUpdate.status, 200);
    const cashierJson = (await cashierUpdate.json()) as {
      data: {
        material: {
          vehiclePrices: {
            TRACTOR: { pricePerFt3: string; version: number };
          };
        };
      };
    };
    assert.equal(
      cashierJson.data.material.vehiclePrices.TRACTOR?.pricePerFt3,
      "48.00"
    );
    assert.equal(cashierJson.data.material.vehiclePrices.TRACTOR?.version, 2);

    // 3b. Stale update with expectedVersion: 1 returns 409 Conflict
    const staleUpdate = await fetch(
      `${baseUrl}/api/materials/${mat34Id}/price`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: cashierCookie,
        },
        body: JSON.stringify({
          vehicleCategory: "TRACTOR",
          newPrice: "50.00",
          reason: "Stale concurrent update attempt",
          expectedVersion: 1,
        }),
      }
    );
    assert.equal(staleUpdate.status, 409);

    // 3c. Owner updates Tipper price for 3/4 Metal with expectedVersion: 1 -> becomes version 2
    const ownerUpdate = await fetch(
      `${baseUrl}/api/materials/${mat34Id}/price`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: ownerCookie,
        },
        body: JSON.stringify({
          vehicleCategory: "TIPPER",
          newPrice: "44.00",
          reason: "Owner updated tipper bulk discount rate",
          expectedVersion: 1,
        }),
      }
    );
    assert.equal(ownerUpdate.status, 200);
    const ownerJson = (await ownerUpdate.json()) as {
      data: {
        material: {
          vehiclePrices: {
            TIPPER: { pricePerFt3: string; version: number };
          };
        };
      };
    };
    assert.equal(
      ownerJson.data.material.vehiclePrices.TIPPER?.pricePerFt3,
      "44.00"
    );
    assert.equal(ownerJson.data.material.vehiclePrices.TIPPER?.version, 2);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Append-only vehicle price history and vehicleCategory filtering
  // ---------------------------------------------------------------------------
  it("4. GET /api/materials/price-history returns append-only audit trail filtered by vehicleCategory", async () => {
    // 4a. Filter by vehicleCategory: TRACTOR
    const tractorHistRes = await fetch(
      `${baseUrl}/api/materials/price-history?vehicleCategory=TRACTOR`,
      { headers: { Cookie: ownerCookie } }
    );
    assert.equal(tractorHistRes.status, 200);
    const tractorHist = (await tractorHistRes.json()) as {
      data: {
        history: Array<{
          materialId: number;
          vehicleCategory: string;
          oldPrice: string;
          newPrice: string;
          changedByUserName: string;
          reason: string;
        }>;
      };
    };
    const tractorEntry = tractorHist.data.history.find(
      (h) => h.materialId === mat34Id && h.vehicleCategory === "TRACTOR"
    );
    assert.ok(tractorEntry, "Expected tractor history entry");
    assert.equal(tractorEntry.oldPrice, "45.00");
    assert.equal(tractorEntry.newPrice, "48.00");

    // 4b. Filter by vehicleCategory: TIPPER
    const tipperHistRes = await fetch(
      `${baseUrl}/api/materials/price-history?vehicleCategory=TIPPER`,
      { headers: { Cookie: ownerCookie } }
    );
    assert.equal(tipperHistRes.status, 200);
    const tipperHist = (await tipperHistRes.json()) as typeof tractorHist;
    const tipperEntry = tipperHist.data.history.find(
      (h) => h.materialId === mat34Id && h.vehicleCategory === "TIPPER"
    );
    assert.ok(tipperEntry, "Expected tipper history entry");
    assert.equal(tipperEntry.oldPrice, "42.50");
    assert.equal(tipperEntry.newPrice, "44.00");

    // 4c. Filter vehicleCategory: ALL returns both
    const allHistRes = await fetch(
      `${baseUrl}/api/materials/price-history?vehicleCategory=ALL`,
      { headers: { Cookie: ownerCookie } }
    );
    assert.equal(allHistRes.status, 200);
    const allHist = (await allHistRes.json()) as typeof tractorHist;
    assert.ok(allHist.data.history.some((h) => h.vehicleCategory === "TRACTOR"));
    assert.ok(allHist.data.history.some((h) => h.vehicleCategory === "TIPPER"));
  });

  // ---------------------------------------------------------------------------
  // Test 5: Invoice issuance with TRACTOR and TIPPER using ft³
  // ---------------------------------------------------------------------------
  let tractorInvoiceId: number;
  let tipperInvoiceId: number;

  it("5. POST /api/invoices creates invoices in ft³ using vehicleCategory-determined rates", async () => {
    // 5a. Create invoice with TRACTOR:
    // Quantity: 100.000 ft³ of 3/4 Metal @ 48.00 = 4,800.00
    // Quantity: 50.000 ft³ of Dust @ 35.00 = 1,750.00
    // Subtotal = 6,550.00
    // Transport fee = 2,500.00 (hasTransport = true)
    // Grand Total = 9,050.00
    // Initial Paid = 4,000.00 -> Balance Due = 5,050.00
    const tractorRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        customerId,
        vehicleCategory: "TRACTOR",
        items: [
          { materialId: mat34Id, quantity: "100.000" },
          { materialId: matDustId, quantity: "50.000" },
        ],
        hasTransport: true,
        transportFee: "2500.00",
        initialPaymentAmount: "4000.00",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(tractorRes.status, 201);
    const tractorJson = (await tractorRes.json()) as {
      data: {
        invoice: {
          id: number;
          invoiceNumber: string;
          vehicleCategory: string;
          unitSnapshot: string;
          subtotal: string;
          grandTotal: string;
          paidAmount: string;
          balanceDue: string;
          paymentStatus: string;
          items: Array<{
            materialId: number;
            unitSnapshot?: string;
            unitPrice: string;
            quantity: string;
            lineTotal: string;
          }>;
        };
      };
    };

    const tInv = tractorJson.data.invoice;
    tractorInvoiceId = tInv.id;
    assert.equal(tInv.vehicleCategory, "TRACTOR");
    assert.equal(tInv.unitSnapshot, "ft³");
    assert.equal(tInv.subtotal, "6550.00");
    assert.equal(tInv.grandTotal, "9050.00");
    assert.equal(tInv.paidAmount, "4000.00");
    assert.equal(tInv.balanceDue, "5050.00");
    assert.equal(tInv.paymentStatus, "PARTIALLY_PAID");
    assert.equal(tInv.items.length, 2);

    // Verify items have unitSnapshot = 'ft³' and correct rate snapshot
    const item34 = tInv.items.find((i) => i.materialId === mat34Id);
    assert.ok(item34);
    assert.equal(item34.unitSnapshot, "ft³");
    assert.equal(item34.unitPrice, "48.00");
    assert.equal(item34.lineTotal, "4800.00");

    const itemDust = tInv.items.find((i) => i.materialId === matDustId);
    assert.ok(itemDust);
    assert.equal(itemDust.unitSnapshot, "ft³");
    assert.equal(itemDust.unitPrice, "35.00");
    assert.equal(itemDust.lineTotal, "1750.00");

    // 5b. Create invoice with TIPPER:
    // Quantity: 200.000 ft³ of 3/4 Metal @ 44.00 = 8,800.00
    // No transport (hasTransport = false, transportFee = 0.00)
    // Initial Paid = 8,800.00 (Full payment) -> Balance Due = 0.00, PAID
    const tipperRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        customerId,
        vehicleCategory: "TIPPER",
        items: [{ materialId: mat34Id, quantity: "200.000" }],
        hasTransport: false,
        transportFee: "0.00",
        initialPaymentAmount: "8800.00",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(tipperRes.status, 201);
    const tipperJson = (await tipperRes.json()) as typeof tractorJson;
    const tipInv = tipperJson.data.invoice;
    tipperInvoiceId = tipInv.id;

    assert.equal(tipInv.vehicleCategory, "TIPPER");
    assert.equal(tipInv.unitSnapshot, "ft³");
    assert.equal(tipInv.subtotal, "8800.00");
    assert.equal(tipInv.grandTotal, "8800.00");
    assert.equal(tipInv.paidAmount, "8800.00");
    assert.equal(tipInv.balanceDue, "0.00");
    assert.equal(tipInv.paymentStatus, "PAID");
    assert.equal(tipInv.items[0].unitSnapshot, "ft³");
    assert.equal(tipInv.items[0].unitPrice, "44.00");
  });

  // ---------------------------------------------------------------------------
  // Test 6: Decimal-safe calculations on rounding edge cases
  // ---------------------------------------------------------------------------
  it("6. Computes exact decimal math on fractional ft³ quantities without floating-point drift", async () => {
    // 13.333 ft³ @ 44.00 = 586.652 -> rounds to 586.65
    // Transport fee = 1250.50
    // Grand Total = 1837.15
    const edgeRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        customerId,
        vehicleCategory: "TIPPER",
        items: [{ materialId: mat34Id, quantity: "13.333" }],
        hasTransport: true,
        transportFee: "1250.50",
        initialPaymentAmount: "0.00",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(edgeRes.status, 201);
    const edgeJson = (await edgeRes.json()) as {
      data: {
        invoice: {
          subtotal: string;
          grandTotal: string;
          items: Array<{ lineTotal: string }>;
        };
      };
    };
    assert.equal(edgeJson.data.invoice.items[0].lineTotal, "586.65");
    assert.equal(edgeJson.data.invoice.subtotal, "586.65");
    assert.equal(edgeJson.data.invoice.grandTotal, "1837.15");
  });

  // ---------------------------------------------------------------------------
  // Test 7: Transport calculation preservation
  // ---------------------------------------------------------------------------
  it("7. Preserves unchanged transport calculation logic", async () => {
    // hasTransport: false with non-zero transport fee is rejected
    const badTransport = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        customerId,
        vehicleCategory: "TRACTOR",
        items: [{ materialId: mat34Id, quantity: "10.000" }],
        hasTransport: false,
        transportFee: "500.00",
        initialPaymentAmount: "0.00",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(badTransport.status, 400);

    // Negative transport fee is rejected
    const negTransport = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        customerId,
        vehicleCategory: "TRACTOR",
        items: [{ materialId: mat34Id, quantity: "10.000" }],
        hasTransport: true,
        transportFee: "-100.00",
        initialPaymentAmount: "0.00",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(negTransport.status, 400);
  });

  // ---------------------------------------------------------------------------
  // Test 8: Invoice Detail & History endpoints return vehicleCategory and ft³
  // ---------------------------------------------------------------------------
  it("8. GET /api/invoices/:id and GET /api/invoices return vehicleCategory and unit snapshots", async () => {
    // 8a. Detail endpoint
    const detailRes = await fetch(`${baseUrl}/api/invoices/${tractorInvoiceId}`, {
      headers: { Cookie: cashierCookie },
    });
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as {
      data: {
        invoice: {
          id: number;
          vehicleCategory: string;
          unitSnapshot: string;
          items: Array<{ unitSnapshot?: string; unitPrice: string }>;
        };
      };
    };
    assert.equal(detailJson.data.invoice.vehicleCategory, "TRACTOR");
    assert.equal(detailJson.data.invoice.unitSnapshot, "ft³");
    assert.equal(detailJson.data.invoice.items[0].unitSnapshot, "ft³");

    // 8b. History endpoint
    const histRes = await fetch(`${baseUrl}/api/invoices?limit=10`, {
      headers: { Cookie: cashierCookie },
    });
    assert.equal(histRes.status, 200);
    const histJson = (await histRes.json()) as {
      data: {
        invoices: Array<{
          id: number;
          vehicleCategory: string | null;
          unitSnapshot?: string;
        }>;
      };
    };
    const foundTractor = histJson.data.invoices.find((i) => i.id === tractorInvoiceId);
    assert.ok(foundTractor);
    assert.equal(foundTractor.vehicleCategory, "TRACTOR");

    const foundTipper = histJson.data.invoices.find((i) => i.id === tipperInvoiceId);
    assert.ok(foundTipper);
    assert.equal(foundTipper.vehicleCategory, "TIPPER");
  });

  // ---------------------------------------------------------------------------
  // Test 9: Invoice snapshot immutability
  // ---------------------------------------------------------------------------
  it("9. Enforces database trigger rejection on any UPDATE or DELETE on commercial invoice terms", async () => {
    // Attempt updating invoice grand_total directly via SQL
    await assert.rejects(
      async () => {
        await adminPool.query(
          "UPDATE public.invoices SET grand_total = 99999.00 WHERE id = $1",
          [tractorInvoiceId]
        );
      },
      (err: Error) => {
        assert.match(err.message, /immutable|cannot be modified/i);
        return true;
      }
    );

    // Attempt updating invoice_items directly via SQL
    await assert.rejects(
      async () => {
        await adminPool.query(
          "UPDATE public.invoice_items SET unit_price = 999.00 WHERE invoice_id = $1",
          [tractorInvoiceId]
        );
      },
      (err: Error) => {
        assert.match(err.message, /immutable|cannot be modified/i);
        return true;
      }
    );

    // Attempt deleting invoice_items
    await assert.rejects(
      async () => {
        await adminPool.query(
          "DELETE FROM public.invoice_items WHERE invoice_id = $1",
          [tractorInvoiceId]
        );
      },
      (err: Error) => {
        assert.match(err.message, /immutable|cannot be deleted|forbidden/i);
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 10: Historical m³ invoice preservation
  // ---------------------------------------------------------------------------
  it("10. Historical m³ invoices retain null vehicleCategory and m³ unit snapshots", async () => {
    // Insert a simulated pre-migration-015 invoice via atomic draft-then-issued lifecycle
    const client = await adminPool.connect();
    let oldInvId: number;
    try {
      await client.query("BEGIN");
      const oldInvRes = await client.query<{ id: string | number }>(
        `INSERT INTO public.invoices (
           invoice_number, customer_id, customer_name_snapshot, customer_phone_snapshot,
           customer_location_snapshot, subtotal, transport_fee, grand_total,
           status, issued_by_user_id,
           vehicle_category, unit_snapshot
         ) VALUES (
           'NPR-INV-HIST01', $1, 'Historical Client', '0770001122',
           'Kurunegala Old Yard', 0.00, 0.00, 0.00,
           'DRAFT', $2,
           NULL, 'm³'
         ) RETURNING id`,
        [customerId, ownerUserId]
      );
      oldInvId = Number(oldInvRes.rows[0].id);

      await client.query(
        `INSERT INTO public.invoice_items (
           invoice_id, material_id, material_name_snapshot,
           unit_snapshot, unit_price, quantity, line_total
         ) VALUES (
           $1, $2, '3/4 Metal',
           'm³', 12000.00, 2.000, 24000.00
         )`,
        [oldInvId, mat34Id]
      );

      await client.query(
        `UPDATE public.invoices
         SET status = 'ISSUED', subtotal = 24000.00, grand_total = 24000.00, issued_at = NOW()
         WHERE id = $1`,
        [oldInvId]
      );

      await client.query(
        `INSERT INTO public.payments (
           receipt_number, invoice_id, cashier_user_id, amount, payment_method, idempotency_key
         ) VALUES (
           'NPR-REC-HIST01', $1, $2, 24000.00, 'CASH', 'idem-hist-payment-12345678'
         )`,
        [oldInvId, ownerUserId]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    // Fetch via API
    const res = await fetch(`${baseUrl}/api/invoices/${oldInvId}`, {
      headers: { Cookie: cashierCookie },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      data: {
        invoice: {
          id: number;
          vehicleCategory: string | null;
          unitSnapshot: string;
          grandTotal: string;
          items: Array<{ unitSnapshot?: string; unitPrice: string; quantity: string }>;
        };
      };
    };

    const inv = json.data.invoice;
    assert.equal(inv.vehicleCategory, null, "Historical invoice must have null vehicleCategory");
    assert.equal(inv.unitSnapshot, "m³", "Historical invoice must retain m³ unit snapshot");
    assert.equal(inv.grandTotal, "24000.00");
    assert.equal(inv.items[0].unitSnapshot, "m³");
    assert.equal(inv.items[0].quantity, "2.000");
    assert.equal(inv.items[0].unitPrice, "12000.00");
  });

  // ---------------------------------------------------------------------------
  // Test 11: Subsequent payment on ft³ invoice
  // ---------------------------------------------------------------------------
  it("11. Subsequent cash payment reduces balance and updates payment status on ft³ invoice", async () => {
    // Partially paid tractor invoice has balance_due = 5050.00
    const payRes = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        invoiceId: tractorInvoiceId,
        amount: "5050.00",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(payRes.status, 201);
    const payJson = (await payRes.json()) as {
      data: {
        payment: { receiptNumber: string; amount: string };
        invoice: { balanceDue: string; paymentStatus: string };
      };
    };
    assert.match(payJson.data.payment.receiptNumber, /^NPR-REC-\d{6,}$/);
    assert.equal(payJson.data.payment.amount, "5050.00");
    assert.equal(payJson.data.invoice.balanceDue, "0.00");
    assert.equal(payJson.data.invoice.paymentStatus, "PAID");

    // Overpayment is blocked (returns 409 Conflict)
    const overpay = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cashierCookie,
      },
      body: JSON.stringify({
        invoiceId: tractorInvoiceId,
        amount: "100.00",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(overpay.status, 409);
  });

  // ---------------------------------------------------------------------------
  // Test 12: Restricted role RLS enforcement on material_vehicle_prices
  // ---------------------------------------------------------------------------
  it("12. Enforces RLS and least-privilege security for npr_app_user", async () => {
    // 12a. npr_app_user can SELECT and UPDATE material_vehicle_prices
    const selRes = await appUserPool.query(
      "SELECT price_per_ft3 FROM public.material_vehicle_prices WHERE material_id = $1 AND vehicle_category = 'TRACTOR'",
      [mat34Id]
    );
    assert.ok(selRes.rows.length > 0);

    // 12b. npr_app_user is BLOCKED from DELETE on material_vehicle_prices
    await assert.rejects(
      async () => {
        await appUserPool.query(
          "DELETE FROM public.material_vehicle_prices WHERE material_id = $1",
          [mat34Id]
        );
      },
      (err: Error) => {
        assert.match(err.message, /permission denied/i);
        return true;
      }
    );

    // 12c. npr_app_user is BLOCKED from UPDATE or DELETE on material_vehicle_price_history (append-only)
    await assert.rejects(
      async () => {
        await appUserPool.query(
          "UPDATE public.material_vehicle_price_history SET reason = 'tampered'"
        );
      },
      (err: Error) => {
        assert.match(err.message, /permission denied/i);
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await appUserPool.query(
          "DELETE FROM public.material_vehicle_price_history"
        );
      },
      (err: Error) => {
        assert.match(err.message, /permission denied/i);
        return true;
      }
    );

    // 12d. npr_app_user is BLOCKED from pgmigrations
    await assert.rejects(
      async () => {
        await appUserPool.query("SELECT * FROM public.pgmigrations");
      },
      (err: Error) => {
        assert.match(err.message, /permission denied/i);
        return true;
      }
    );
  });
});
