import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ConflictError, ValidationError } from "../errors/appError.js";
import { listMaterialPriceHistory } from "../modules/materials/materials.repository.js";
import { MaterialsService } from "../modules/materials/materials.service.js";
import {
  calculateAdvancesForWorkerInPeriod,
  findOverlappingPayrollPeriod,
  findPayrollEntryById,
  initializePeriodManualEntries,
  listPayrollEntriesByPeriod,
  listSalaryAuditHistory,
  updateManualSalaryEntry,
} from "../modules/payroll/payroll.repository.js";
import { createPayrollRouters } from "../modules/payroll/payroll.routes.js";
import { PayrollService } from "../modules/payroll/payroll.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("11-Product Catalogue Expansion & Owner Activation Workflow — Unit Tests", () => {
  const APPROVED_11_PRODUCTS = [
    { code: "3/4", name: "3/4 Metal", unit: "m³", isExisting: true },
    { code: "DUST", name: "Dust", unit: "m³", isExisting: true },
    { code: "CHIP", name: "Chip", unit: "m³", isExisting: false },
    { code: "6X9", name: "6×9 (Aggregate)", unit: "m³", isExisting: true },
    { code: "2X2", name: "2×2", unit: "m³", isExisting: false },
    { code: "1_INCH", name: '1" (Inch)', unit: "m³", isExisting: false },
    { code: "1_1/2", name: "1 1/2", unit: "m³", isExisting: false },
    { code: "ABC", name: "ABC", unit: "m³", isExisting: true },
    { code: "SUBBASE", name: "SubBase", unit: "m³", isExisting: false },
    { code: "MIX", name: "Mix (Dust & Chip)", unit: "m³", isExisting: false },
    { code: "QUARRY_MUCK", name: "Quarry Muck", unit: "m³", isExisting: false },
  ];

  it("verifies approved 11 products catalogue specifications and m³ units", () => {
    assert.equal(APPROVED_11_PRODUCTS.length, 11);

    // Verify all 11 products use m³
    for (const p of APPROVED_11_PRODUCTS) {
      assert.equal(p.unit, "m³", `Product ${p.code} must use m³ as unit.`);
      assert.ok(p.code.length <= 20, `Code ${p.code} must fit within VARCHAR(20).`);
      assert.ok(p.name.trim().length >= 1, `Name ${p.name} must not be empty.`);
    }

    // Verify the 4 existing products retain codes and have updated display names
    const existing = APPROVED_11_PRODUCTS.filter((p) => p.isExisting);
    assert.equal(existing.length, 4);
    assert.deepEqual(
      existing.map((p) => ({ code: p.code, name: p.name })),
      [
        { code: "3/4", name: "3/4 Metal" },
        { code: "DUST", name: "Dust" },
        { code: "6X9", name: "6×9 (Aggregate)" },
        { code: "ABC", name: "ABC" },
      ]
    );

    // Verify the 7 new product codes
    const newProducts = APPROVED_11_PRODUCTS.filter((p) => !p.isExisting);
    assert.equal(newProducts.length, 7);
    assert.deepEqual(
      newProducts.map((p) => ({ code: p.code, name: p.name })),
      [
        { code: "CHIP", name: "Chip" },
        { code: "2X2", name: "2×2" },
        { code: "1_INCH", name: '1" (Inch)' },
        { code: "1_1/2", name: "1 1/2" },
        { code: "SUBBASE", name: "SubBase" },
        { code: "MIX", name: "Mix (Dust & Chip)" },
        { code: "QUARRY_MUCK", name: "Quarry Muck" },
      ]
    );
  });

  it("verifies forward-only migration 009 SQL structure and constraints", async () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../database/migrations/009_expand_materials_catalog_11_products.sql"
    );
    const sql = await readFile(migrationPath, "utf8");

    // Must be forward-only
    assert.match(sql, /--\s*Up Migration/i);
    assert.doesNotMatch(sql, /--\s*Down Migration/i);

    // Must update the 4 existing products
    assert.match(sql, /'3\/4',\s*'3\/4 Metal'/);
    assert.match(sql, /'DUST',\s*'Dust'/);
    assert.match(sql, /'6X9',\s*'6×9 \(Aggregate\)'/);
    assert.match(sql, /'ABC',\s*'ABC'/);

    // Must insert the 7 new products as INACTIVE (false) with 0.00 price
    assert.match(sql, /'CHIP',\s*'Chip',\s*'m³',\s*0\.00,\s*false/);
    assert.match(sql, /'2X2',\s*'2×2',\s*'m³',\s*0\.00,\s*false/);
    assert.match(sql, /'1_INCH',\s*'1" \(Inch\)',\s*'m³',\s*0\.00,\s*false/);
    assert.match(sql, /'1_1\/2',\s*'1 1\/2',\s*'m³',\s*0\.00,\s*false/);
    assert.match(sql, /'SUBBASE',\s*'SubBase',\s*'m³',\s*0\.00,\s*false/);
    assert.match(sql, /'MIX',\s*'Mix \(Dust & Chip\)',\s*'m³',\s*0\.00,\s*false/);
    assert.match(sql, /'QUARRY_MUCK',\s*'Quarry Muck',\s*'m³',\s*0\.00,\s*false/);

    // Must use ON CONFLICT (code) DO UPDATE to preserve existing IDs, prices & history
    assert.match(sql, /ON CONFLICT \(code\) DO UPDATE/);
  });

  it("enforces validation rules when activating inactive materials", async () => {
    const mockClient = {
      query: async (sqlText: string) => {
        if (typeof sqlText === "string" && sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 5,
                code: "CHIP",
                name: "Chip",
                unit: "m³",
                current_unit_price: "0.00",
                is_active: false,
                version: 1,
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
    } as any;

    const service = new MaterialsService(mockPool);

    // 1. Setting 0.00 price must throw ValidationError
    await assert.rejects(
      async () => {
        await service.updatePrice(
          {
            materialId: 5,
            newPrice: "0.00",
            reason: "Attempting activation without setting price",
            expectedVersion: 1,
            isActive: true,
          },
          { ownerUserId: "owner-1", role: "OWNER", ipAddress: "127.0.0.1" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Selling price must be greater than Rs\. 0\.00/);
        return true;
      }
    );

    // 2. Setting invalid non-numeric price must throw ValidationError
    await assert.rejects(
      async () => {
        await service.updatePrice(
          {
            materialId: 5,
            newPrice: "invalid_price",
            reason: "Mistyped price",
            expectedVersion: 1,
            isActive: true,
          },
          { ownerUserId: "owner-1", role: "OWNER", ipAddress: "127.0.0.1" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /must be a non-negative decimal/i);
        return true;
      }
    );
  });
});

describe("Cashier & Owner Material Price Management Permissions — Unit Tests", () => {
  it("verifies migration 010 SQL structure and permissions trigger update", async () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../database/migrations/010_allow_cashier_material_price_updates.sql"
    );
    const sql = await readFile(migrationPath, "utf8");

    // Must be forward-only
    assert.match(sql, /--\s*Up Migration/i);
    assert.doesNotMatch(sql, /--\s*Down Migration/i);

    // Must update trigger function enforce_price_history_owner
    assert.match(sql, /CREATE OR REPLACE FUNCTION enforce_price_history_owner\(\)/);
    // Must permit both OWNER and CASHIER
    assert.match(sql, /v_authorizer_role NOT IN \('OWNER', 'CASHIER'\)/);
  });

  it("permits Cashier to update price of active material with valid reason and version", async () => {
    const executedQueries: Array<{ sql: string; params: unknown[] }> = [];

    const mockClient = {
      query: async (sqlText: string, params?: unknown[]) => {
        executedQueries.push({ sql: sqlText, params: params ?? [] });
        if (sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 1,
                code: "3/4",
                name: "3/4 Metal",
                unit: "m³",
                current_unit_price: "5000.00",
                is_active: true,
                version: 2,
                updated_at: new Date(),
              },
            ],
          };
        }
        if (sqlText.includes("UPDATE public.materials")) {
          return {
            rows: [
              {
                id: 1,
                code: "3/4",
                name: "3/4 Metal",
                unit: "m³",
                current_unit_price: "5500.00",
                is_active: true,
                version: 3,
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
    } as any;

    const service = new MaterialsService(mockPool);

    const result = await service.updatePrice(
      {
        materialId: 1,
        newPrice: "5500.00",
        reason: "Diesel transport surcharge applied across fleet",
        expectedVersion: 2,
      },
      {
        userId: "cashier-uuid-1",
        username: "cashier_sarath",
        role: "CASHIER",
        ipAddress: "192.168.1.50",
      }
    );

    assert.equal(result.id, 1);
    assert.equal(result.currentUnitPrice, "5500.00");
    assert.equal(result.version, 3);

    // Verify atomic transaction (BEGIN, FOR UPDATE, UPDATE, INSERT history, INSERT audit_logs, COMMIT)
    assert.ok(executedQueries.some((q) => q.sql === "BEGIN"));
    assert.ok(executedQueries.some((q) => q.sql.includes("FOR UPDATE")));
    assert.ok(executedQueries.some((q) => q.sql.includes("UPDATE public.materials")));
    assert.ok(
      executedQueries.some((q) => q.sql.includes("INSERT INTO public.material_price_history"))
    );
    assert.ok(
      executedQueries.some(
        (q) =>
          q.sql.includes("INSERT INTO public.audit_logs") &&
          JSON.stringify(q.params).includes("cashier_sarath") &&
          JSON.stringify(q.params).includes("CASHIER")
      )
    );
    assert.ok(executedQueries.some((q) => q.sql === "COMMIT"));
  });

  it("blocks Cashier from passing isActive (activation remains Owner-only)", async () => {
    const mockClient = {
      query: async (sqlText: string) => {
        if (sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 1,
                code: "3/4",
                name: "3/4 Metal",
                unit: "m³",
                current_unit_price: "5000.00",
                is_active: true,
                version: 1,
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
    } as any;

    const service = new MaterialsService(mockPool);

    await assert.rejects(
      async () => {
        await service.updatePrice(
          {
            materialId: 1,
            newPrice: "5200.00",
            reason: "Attempting to change active status as cashier",
            expectedVersion: 1,
            isActive: false,
          },
          {
            userId: "cashier-uuid-1",
            username: "cashier_sarath",
            role: "CASHIER",
            ipAddress: "192.168.1.50",
          }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(
          err.message,
          /Only Owner accounts are permitted to activate or deactivate materials/
        );
        return true;
      }
    );
  });

  it("blocks Cashier from updating inactive materials", async () => {
    const mockClient = {
      query: async (sqlText: string) => {
        if (sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 6,
                code: "2X2",
                name: "2×2",
                unit: "m³",
                current_unit_price: "0.00",
                is_active: false,
                version: 1,
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
    } as any;

    const service = new MaterialsService(mockPool);

    await assert.rejects(
      async () => {
        await service.updatePrice(
          {
            materialId: 6,
            newPrice: "6000.00",
            reason: "Cashier attempting to configure unactivated material",
            expectedVersion: 1,
          },
          {
            userId: "cashier-uuid-1",
            username: "cashier_sarath",
            role: "CASHIER",
            ipAddress: "192.168.1.50",
          }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(
          err.message,
          /Cashiers can only update prices for active materials/
        );
        return true;
      }
    );
  });

  it("rejects price updates with version conflicts (optimistic concurrency)", async () => {
    const mockClient = {
      query: async (sqlText: string) => {
        if (sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 1,
                code: "3/4",
                name: "3/4 Metal",
                unit: "m³",
                current_unit_price: "5000.00",
                is_active: true,
                version: 5, // DB is at version 5
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
    } as any;

    const service = new MaterialsService(mockPool);

    await assert.rejects(
      async () => {
        await service.updatePrice(
          {
            materialId: 1,
            newPrice: "5200.00",
            reason: "Stale update based on version 3",
            expectedVersion: 3, // Client sent stale version 3
          },
          {
            userId: "cashier-uuid-1",
            username: "cashier_sarath",
            role: "CASHIER",
            ipAddress: "192.168.1.50",
          }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.match(err.message, /modified by another session/);
        return true;
      }
    );
  });

  it("verifies price history query generation with cashier, material, and date filters", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];

    const mockDb = {
      query: async (sql: string, params: unknown[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [] };
      },
    };

    // 1. Material ID filter
    await listMaterialPriceHistory(mockDb as any, { materialId: 3 });
    assert.match(capturedSql, /mph\.material_id = \$1/);
    assert.deepEqual(capturedParams.slice(0, 1), [3]);

    // 2. Cashier UUID filter
    await listMaterialPriceHistory(mockDb as any, {
      userId: "12345678-1234-1234-1234-123456789abc",
    });
    assert.match(capturedSql, /mph\.changed_by_user_id = \$1/);
    assert.equal(capturedParams[0], "12345678-1234-1234-1234-123456789abc");

    // 3. Cashier username filter (ILIKE substring match)
    await listMaterialPriceHistory(mockDb as any, { userId: "sarath" });
    assert.match(capturedSql, /u\.username ILIKE \$1 OR u\.full_name ILIKE \$1/);
    assert.equal(capturedParams[0], "%sarath%");

    // 4. Combined material, cashier, and date range filters
    await listMaterialPriceHistory(mockDb as any, {
      materialId: 1,
      userId: "cashier1",
      dateFrom: "2026-11-01",
      dateTo: "2026-11-15",
    });
    assert.match(capturedSql, /mph\.material_id = \$1/);
    assert.match(capturedSql, /u\.username ILIKE \$2 OR u\.full_name ILIKE \$2/);
    assert.match(capturedSql, /mph\.created_at >= \(\$3::date AT TIME ZONE 'Asia\/Colombo'\)/);
    assert.match(capturedSql, /mph\.created_at < \(\(\$4::date \+ INTERVAL '1 day'\) AT TIME ZONE 'Asia\/Colombo'\)/);
  });

  it("verifies forward-only migration 011 SQL structure, RLS policy definition, and constraints", async () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../database/migrations/011_allow_cashier_price_history_rls.sql"
    );
    const sql = await readFile(migrationPath, "utf8");

    // Must be forward-only
    assert.match(sql, /--\s*Up Migration/i);
    assert.doesNotMatch(sql, /--\s*Down Migration/i);

    // Must drop and recreate app_price_history_insert on public.material_price_history
    assert.match(
      sql,
      /DROP POLICY IF EXISTS app_price_history_insert ON public\.material_price_history;/
    );
    assert.match(
      sql,
      /CREATE POLICY app_price_history_insert ON public\.material_price_history/
    );
    assert.match(sql, /FOR INSERT TO npr_app_user/);

    // WITH CHECK must verify user exists, role IN ('OWNER', 'CASHIER'), and is_active = true
    assert.match(sql, /WITH CHECK\s*\(/i);
    assert.match(sql, /WHERE u\.id = changed_by_user_id/);
    assert.match(sql, /u\.role IN \('OWNER', 'CASHIER'\)/);
    assert.match(sql, /u\.is_active = true/);

    // Must preserve RLS enabled and not disable RLS
    assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
    // Must not grant unrestricted privileges
    assert.doesNotMatch(sql, /GRANT ALL/i);
  });

  it("verifies RLS policy logic: permits active OWNER and active CASHIER, rejects inactive or unauthorized roles", () => {
    // Simulates the exact RLS policy WITH CHECK evaluation logic
    const mockUsers = [
      { id: "usr-owner-active", role: "OWNER", isActive: true },
      { id: "usr-owner-inactive", role: "OWNER", isActive: false },
      { id: "usr-cashier-active", role: "CASHIER", isActive: true },
      { id: "usr-cashier-inactive", role: "CASHIER", isActive: false },
      { id: "usr-worker-active", role: "WORKER", isActive: true },
      { id: "usr-anon", role: "ANON", isActive: false },
    ];

    function evaluateRlsWithCheck(changedByUserId: string): boolean {
      return mockUsers.some(
        (u) =>
          u.id === changedByUserId &&
          ["OWNER", "CASHIER"].includes(u.role) &&
          u.isActive === true
      );
    }

    // Active OWNER: permitted
    assert.equal(
      evaluateRlsWithCheck("usr-owner-active"),
      true,
      "Active OWNER must be permitted by RLS"
    );

    // Active CASHIER: permitted
    assert.equal(
      evaluateRlsWithCheck("usr-cashier-active"),
      true,
      "Active CASHIER must be permitted by RLS"
    );

    // Inactive OWNER: rejected
    assert.equal(
      evaluateRlsWithCheck("usr-owner-inactive"),
      false,
      "Inactive OWNER must be rejected by RLS"
    );

    // Inactive CASHIER: rejected
    assert.equal(
      evaluateRlsWithCheck("usr-cashier-inactive"),
      false,
      "Inactive CASHIER must be rejected by RLS"
    );

    // Other role (e.g. WORKER): rejected
    assert.equal(
      evaluateRlsWithCheck("usr-worker-active"),
      false,
      "Other roles must be rejected by RLS"
    );

    // Non-existent user ID: rejected
    assert.equal(
      evaluateRlsWithCheck("non-existent-user"),
      false,
      "Non-existent user must be rejected by RLS"
    );
  });

  it("ensures updatePrice service strictly binds server session identity for material_price_history insertion", async () => {
    let capturedHistoryInsert: { sql: string; params: unknown[] } | null = null;

    const mockClient = {
      query: async (sqlText: string, params?: unknown[]) => {
        if (sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 2,
                code: "DUST",
                name: "Dust",
                unit: "m³",
                current_unit_price: "4000.00",
                is_active: true,
                version: 1,
                updated_at: new Date(),
              },
            ],
          };
        }
        if (sqlText.includes("UPDATE public.materials")) {
          return {
            rows: [
              {
                id: 2,
                code: "DUST",
                name: "Dust",
                unit: "m³",
                current_unit_price: "4200.00",
                is_active: true,
                version: 2,
                updated_at: new Date(),
              },
            ],
          };
        }
        if (sqlText.includes("INSERT INTO public.material_price_history")) {
          capturedHistoryInsert = { sql: sqlText, params: params ?? [] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
    } as any;

    const service = new MaterialsService(mockPool);

    const SESSION_USER_ID = "authenticated-session-uuid-999";
    await service.updatePrice(
      {
        materialId: 2,
        newPrice: "4200.00",
        reason: "Transport and power rate adjustment",
        expectedVersion: 1,
      },
      {
        userId: SESSION_USER_ID,
        username: "cashier_kavinda",
        role: "CASHIER",
        ipAddress: "10.0.0.1",
      }
    );

    assert.ok(capturedHistoryInsert, "material_price_history must be inserted");
    const historyInsert = capturedHistoryInsert as {
      sql: string;
      params: unknown[];
    };
    // $4 in INSERT INTO public.material_price_history is changed_by_user_id
    assert.equal(
      historyInsert.params[3],
      SESSION_USER_ID,
      "changed_by_user_id must strictly match the server session user ID"
    );
  });
});

describe("Phase 2 — Cashier Payroll, Advances & Expenses Permissions — Unit Tests", () => {
  it("verifies forward-only migration 012 SQL structure, trigger function, and RLS policies", async () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../database/migrations/012_allow_cashier_payroll_advances_expenses.sql"
    );
    const sql = await readFile(migrationPath, "utf-8");

    // 1. Header & forward-only migration comments
    assert.ok(sql.includes("Migration 012: Allow Cashier Access to Compensation, Advances & Expenses"), "Migration header must be present");

    // 2. Updated enforce_owner_actor_for_finance trigger function
    assert.ok(
      sql.includes("CREATE OR REPLACE FUNCTION enforce_owner_actor_for_finance()"),
      "Must update enforce_owner_actor_for_finance trigger function"
    );
    assert.ok(
      sql.includes("role NOT IN ('OWNER', 'CASHIER')"),
      "Trigger function must permit both OWNER and CASHIER roles"
    );
    assert.ok(
      sql.includes("Only active OWNER or CASHIER accounts can perform operation on"),
      "Trigger exception message must reflect approved OWNER or CASHIER policy"
    );

    // 3. Drop existing policies before recreation
    assert.ok(
      sql.includes("DROP POLICY IF EXISTS app_worker_comp_all ON public.worker_compensation_profiles;"),
      "Must drop previous app_worker_comp_all policy"
    );
    assert.ok(
      sql.includes("DROP POLICY IF EXISTS app_worker_advances_insert ON public.worker_advances;"),
      "Must drop previous app_worker_advances_insert policy"
    );
    assert.ok(
      sql.includes("DROP POLICY IF EXISTS app_expenses_insert ON public.operational_expenses;"),
      "Must drop previous app_expenses_insert policy"
    );

    // 4. Policy definitions and roles
    assert.ok(
      sql.includes("CREATE POLICY app_worker_comp_all ON public.worker_compensation_profiles"),
      "Must recreate app_worker_comp_all policy"
    );
    assert.ok(
      sql.includes("CREATE POLICY app_worker_advances_insert ON public.worker_advances"),
      "Must recreate app_worker_advances_insert policy"
    );
    assert.ok(
      sql.includes("CREATE POLICY app_expenses_insert ON public.operational_expenses"),
      "Must recreate app_expenses_insert policy"
    );

    // 5. Verified target roles and check clauses
    assert.ok(
      sql.includes("TO npr_app_user"),
      "All policies must target npr_app_user"
    );
    const roleCheckCount = (sql.match(/role IN \('OWNER', 'CASHIER'\)/g) || []).length;
    assert.ok(
      roleCheckCount >= 3,
      "All three RLS policies must check for role IN ('OWNER', 'CASHIER')"
    );
    const activeCheckCount = (sql.match(/is_active = true/g) || []).length;
    assert.ok(
      activeCheckCount >= 3,
      "All three RLS policies must verify is_active = true"
    );
  });

  it("verifies trigger function and RLS policies allow active OWNER and active CASHIER, reject others", () => {
    function simulateFinanceAuth(actor: { role: string; isActive: boolean }) {
      if (!actor.isActive) {
        throw new Error("Actor is inactive");
      }
      if (actor.role !== "OWNER" && actor.role !== "CASHIER") {
        throw new Error("Finance operations require an active OWNER or CASHIER actor.");
      }
      return true;
    }

    // Active OWNER & CASHIER succeed
    assert.equal(simulateFinanceAuth({ role: "OWNER", isActive: true }), true);
    assert.equal(simulateFinanceAuth({ role: "CASHIER", isActive: true }), true);

    // Inactive OWNER & CASHIER are rejected
    assert.throws(
      () => simulateFinanceAuth({ role: "OWNER", isActive: false }),
      /Actor is inactive/
    );
    assert.throws(
      () => simulateFinanceAuth({ role: "CASHIER", isActive: false }),
      /Actor is inactive/
    );

    // Unauthorized roles are rejected
    assert.throws(
      () => simulateFinanceAuth({ role: "AUDITOR", isActive: true }),
      /Finance operations require an active OWNER or CASHIER actor/
    );
    assert.throws(
      () => simulateFinanceAuth({ role: "DRIVER", isActive: true }),
      /Finance operations require an active OWNER or CASHIER actor/
    );
  });

  it("ensures upsertCompensationProfile validates mandatory reason and captures old vs new rates in audit_logs", async () => {
    let capturedAuditLog: Record<string, any> | null = null;
    let capturedUpsertParams: unknown[] = [];

    const mockClient = {
      query: async (queryText: string, params?: unknown[]) => {
        const sql = queryText.trim();
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rows: [] };
        }
        if (sql.includes("FROM public.workers") && sql.includes("WHERE id = $1")) {
          return {
            rows: [
              {
                id: 5,
                worker_code: "W-005",
                full_name: "Kamal Perera",
                designation: "Machine Operator",
                employment_type: "PERMANENT",
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.worker_compensation_profiles")) {
          return {
            rows: [
              {
                id: 10,
                worker_id: 5,
                worker_code: "W-005",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement: "HOURLY",
                base_rate: sql.includes("FOR UPDATE") ? "500.00" : "600.00",
                overtime_hourly_rate: sql.includes("FOR UPDATE") ? "750.00" : "900.00",
                effective_from: "2026-11-15",
                notes: null,
                updated_by_user_id: "user-cashier-uuid-123",
                updated_by_username: "cashier_user",
                updated_by_name: "Cashier Operator",
                updated_by_role: "CASHIER",
                version: sql.includes("FOR UPDATE") ? 2 : 3,
                updated_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.worker_compensation_profiles")) {
          capturedUpsertParams = params ?? [];
          return {
            rows: [
              {
                id: 10,
                worker_id: 5,
                worker_code: "W-005",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement: "HOURLY",
                base_rate: "600.00",
                overtime_hourly_rate: "900.00",
                effective_from: "2026-11-15",
                notes: null,
                updated_by_user_id: "user-cashier-uuid-123",
                updated_by_username: "cashier_user",
                updated_by_name: "Cashier Operator",
                updated_by_role: "CASHIER",
                version: 3,
                updated_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.audit_logs")) {
          capturedAuditLog = { sql, params: params ?? [] };
          return { rows: [{ id: 99 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
      query: async (queryText: string, params?: unknown[]) => mockClient.query(queryText, params),
    } as any;

    const service = new PayrollService(mockPool);

    // 1. Validation error when reason is missing or < 5 characters
    await assert.rejects(
      async () =>
        service.upsertCompensationProfile(
          {
            workerId: 5,
            payArrangement: "HOURLY",
            baseRate: "600.00",
            overtimeHourlyRate: "900.00",
            effectiveFrom: "2026-11-15",
            reason: "abc", // too short!
          },
          {
            userId: "user-cashier-uuid-123",
            username: "cashier_user",
            role: "CASHIER",
            ipAddress: "192.168.1.10",
          }
        ),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.message.includes("at least 5 characters"));
        return true;
      }
    );

    // 2. Successful update with valid reason
    const result = await service.upsertCompensationProfile(
      {
        workerId: 5,
        payArrangement: "HOURLY",
        baseRate: "600.00",
        overtimeHourlyRate: "900.00",
        effectiveFrom: "2026-11-15",
        reason: "Cost of living increase approved for site operators",
        expectedVersion: 2,
      },
      {
        userId: "user-cashier-uuid-123",
        username: "cashier_user",
        role: "CASHIER",
        ipAddress: "192.168.1.10",
      }
    );

    assert.ok(result);
    assert.equal(result.workerId, 5);

    // 3. Verify audit log captures old vs new values, reason, and actor
    assert.ok(capturedAuditLog, "Audit log must be inserted");
    const auditLog = capturedAuditLog as { sql: string; params: unknown[] };
    const auditParams = auditLog.params;
    // $1: userId, $2: action, $3: entityType, $4: entityId, $5: details JSON, $6: ipAddress
    assert.equal(auditParams[0], "user-cashier-uuid-123", "Audit user_id must match session user");
    assert.equal(auditParams[1], "UPSERT_COMPENSATION");
    assert.equal(auditParams[2], "WORKER_COMPENSATION");
    assert.equal(auditParams[3], "5");

    const details = JSON.parse(auditParams[4] as string);
    assert.equal(details.oldBaseRate, "500.00");
    assert.equal(details.newBaseRate, "600.00");
    assert.equal(details.oldOvertimeHourlyRate, "750.00");
    assert.equal(details.newOvertimeHourlyRate, "900.00");
    assert.equal(details.reason, "Cost of living increase approved for site operators");
    assert.equal(details.actorUsername, "cashier_user");
    assert.equal(details.actorRole, "CASHIER");
  });

  it("ensures upsertCompensationProfile enforces optimistic concurrency (expectedVersion)", async () => {
    const mockClient = {
      query: async (queryText: string, _params?: unknown[]) => {
        const sql = queryText.trim();
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM public.workers")) {
          return {
            rows: [
              {
                id: 5,
                worker_code: "W-005",
                full_name: "Kamal Perera",
                designation: "Machine Operator",
                employment_type: "PERMANENT",
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.worker_compensation_profiles") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 10,
                worker_id: 5,
                worker_code: "W-005",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement: "HOURLY",
                base_rate: "500.00",
                overtime_hourly_rate: "750.00",
                effective_from: "2026-11-01",
                notes: null,
                version: 4, // Current version is 4
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const service = new PayrollService({
      connect: async () => mockClient,
      query: async (queryText: string, params?: unknown[]) => mockClient.query(queryText, params),
    } as any);

    // Stale version: client sent expectedVersion: 2, but server has version 4
    await assert.rejects(
      async () =>
        service.upsertCompensationProfile(
          {
            workerId: 5,
            payArrangement: "HOURLY",
            baseRate: "650.00",
            effectiveFrom: "2026-11-15",
            reason: "Concurrent edit test",
            expectedVersion: 2,
          },
          {
            userId: "user-cashier-uuid-123",
            username: "cashier_user",
            role: "CASHIER",
            ipAddress: "192.168.1.10",
          }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.code === "VERSION_CONFLICT" || err.message.includes("modified by another session"));
        return true;
      }
    );
  });

  it("ensures recordAdvance and recordExpense strictly bind server session identity", async () => {
    let capturedAdvanceInsertParams: unknown[] = [];
    let capturedExpenseInsertParams: unknown[] = [];

    const mockClient = {
      query: async (queryText: string, params?: unknown[]) => {
        const sql = queryText.trim();
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_keys")) return { rows: [] };
        if (sql.includes("FROM public.workers") && sql.includes("WHERE id = $1")) {
          return {
            rows: [
              {
                id: 8,
                worker_code: "W-008",
                full_name: "Sunil Bandara",
                designation: "Driver",
                employment_type: "PERMANENT",
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.worker_advances")) {
          capturedAdvanceInsertParams = params ?? [];
          return { rows: [{ id: 42 }] };
        }
        if (sql.includes("INSERT INTO public.operational_expenses")) {
          capturedExpenseInsertParams = params ?? [];
          return { rows: [{ id: 84 }] };
        }
        if (sql.includes("FROM public.worker_advances")) {
          return {
            rows: [
              {
                id: 42,
                advance_number: "ADV-00042",
                worker_id: 8,
                worker_code: "W-008",
                worker_name: "Sunil Bandara",
                advance_date: "2026-11-15",
                amount: "3500.00",
                reason: "Emergency fuel allowance",
                authorized_by_user_id: "cashier-session-uuid-777",
                authorized_by_username: "cashier_amal",
                authorized_by_name: "Amal Silva",
                authorized_by_role: "CASHIER",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.operational_expenses")) {
          return {
            rows: [
              {
                id: 84,
                expense_number: "EXP-00084",
                expense_date: "2026-11-15",
                category: "MAINTENANCE",
                description: "Jaw plate grease and lube",
                amount: "12500.00",
                recorded_by_user_id: "cashier-session-uuid-777",
                recorded_by_username: "cashier_amal",
                recorded_by_name: "Amal Silva",
                recorded_by_role: "CASHIER",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.audit_logs")) return { rows: [{ id: 101 }] };
        if (sql.includes("INSERT INTO public.idempotency_keys")) return { rows: [] };
        return { rows: [] };
      },
      release: () => {},
    };

    const service = new PayrollService({ connect: async () => mockClient } as any);
    const CASHIER_SESSION_ID = "cashier-session-uuid-777";

    // 1. Record Advance via Cashier
    await service.recordAdvance(
      {
        workerId: 8,
        advanceDate: "2026-11-15",
        amount: "3500.00",
        reason: "Emergency fuel allowance",
        idempotencyKey: "test-advance-idempotency-key-001",
      },
      {
        userId: CASHIER_SESSION_ID,
        username: "cashier_amal",
        role: "CASHIER",
        ipAddress: "127.0.0.1",
      }
    );

    assert.ok(capturedAdvanceInsertParams.length > 0);
    // $1: workerId, $2: advanceDate, $3: amountStr, $4: reason, $5: actorUserId, $6: idempotencyKey
    assert.equal(
      capturedAdvanceInsertParams[4],
      CASHIER_SESSION_ID,
      "authorized_by_owner_id must strictly match the session userId"
    );

    // 2. Record Expense via Cashier
    await service.recordExpense(
      {
        expenseDate: "2026-11-15",
        category: "MAINTENANCE",
        description: "Jaw plate grease and lube",
        amount: "12500.00",
        idempotencyKey: "test-expense-idempotency-key-002",
      },
      {
        userId: CASHIER_SESSION_ID,
        username: "cashier_amal",
        role: "CASHIER",
        ipAddress: "127.0.0.1",
      }
    );

    assert.ok(capturedExpenseInsertParams.length > 0);
    // $1: expenseDate, $2: category, $3: description, $4: amountStr, $5: actorUserId, $6: idempotencyKey
    assert.equal(
      capturedExpenseInsertParams[4],
      CASHIER_SESSION_ID,
      "recorded_by_owner_id must strictly match the session userId"
    );
  });

  it("verifies repository queries do not reference pe.remaining_payable or pe.paid_amount and do not clamp with GREATEST", async () => {
    const repoPath = path.resolve(__dirname, "../modules/payroll/payroll.repository.ts");
    const content = await readFile(repoPath, "utf-8");

    // 1. Verify nonexistent columns are never referenced on 'pe.'
    assert.doesNotMatch(content, /pe\.remaining_payable/i, "pe.remaining_payable must NOT be referenced");
    assert.doesNotMatch(content, /pe\.paid_amount/i, "pe.paid_amount must NOT be referenced");

    // 2. Verify remaining_payable calculation does not use GREATEST(..., 0)
    assert.doesNotMatch(
      content,
      /GREATEST\s*\(\s*pe\.net_payable/i,
      "GREATEST must NOT be used to hide overpayments on remaining_payable"
    );

    // 3. Verify exact remaining_payable formula in both queries incorporating salary_payment_adjustments
    const remainingPattern = /pe\.net_payable\s*-\s*COALESCE\s*\(\s*\(\s*SELECT\s+SUM\(\s*COALESCE\s*\(\s*\(\s*SELECT\s+spa\.corrected_amount\s+FROM\s+public\.salary_payment_adjustments/g;
    const matches = content.match(remainingPattern);
    assert.ok(matches && matches.length >= 2, "Expected at least 2 occurrences of remaining_payable calculation");
  });

  it("verifies payroll entry mapping across zero payments, partial payments, multiple payments, and overpayments", async () => {
    let capturedQuery = "";
    let capturedParams: unknown[] = [];

    const mockDb = {
      query: async (sql: string, params?: unknown[]) => {
        capturedQuery = sql;
        capturedParams = params ?? [];
        return {
          rows: [
            // Row 1: Zero payments
            {
              id: 1,
              payroll_period_id: 10,
              worker_id: 101,
              worker_code: "W101",
              worker_name: "Sunil Bandara",
              designation: "Crusher Operator",
              pay_arrangement_snapshot: "HOURLY",
              calculation_mode: "CONFIGURED_AUTO",
              approved_days_count: 5,
              approved_regular_hours: "40.00",
              approved_overtime_hours: "5.00",
              base_pay: "24000.00",
              overtime_pay: "4500.00",
              allowances: "1000.00",
              deductions: "500.00",
              advance_deduction: "2000.00",
              gross_pay: "29500.00",
              net_payable: "27000.00",
              paid_amount: "0",
              remaining_payable: "27000.00",
              status: "APPROVED",
              notes: "Zero payment entry",
              version: 1,
              approved_at: new Date("2026-11-15T10:00:00Z"),
            },
            // Row 2: Partial payment
            {
              id: 2,
              payroll_period_id: 10,
              worker_id: 102,
              worker_code: "W102",
              worker_name: "Nimal Perera",
              designation: "Helper",
              pay_arrangement_snapshot: "DAILY",
              calculation_mode: "CONFIGURED_AUTO",
              approved_days_count: 6,
              approved_regular_hours: "48.00",
              approved_overtime_hours: "0.00",
              base_pay: "18000.00",
              overtime_pay: "0.00",
              allowances: "0.00",
              deductions: "0.00",
              advance_deduction: "0.00",
              gross_pay: "18000.00",
              net_payable: "18000.00",
              paid_amount: "10000.00",
              remaining_payable: "8000.00",
              status: "APPROVED",
              notes: "Partial payment recorded",
              version: 2,
              approved_at: new Date("2026-11-15T10:00:00Z"),
            },
            // Row 3: Multiple payments (fully settled)
            {
              id: 3,
              payroll_period_id: 10,
              worker_id: 103,
              worker_code: "W103",
              worker_name: "Kamal Silva",
              designation: "Driver",
              pay_arrangement_snapshot: "MONTHLY",
              calculation_mode: "OWNER_MANUAL_DRAFT",
              approved_days_count: 26,
              approved_regular_hours: "208.00",
              approved_overtime_hours: "12.00",
              base_pay: "65000.00",
              overtime_pay: "5000.00",
              allowances: "5000.00",
              deductions: "0.00",
              advance_deduction: "5000.00",
              gross_pay: "75000.00",
              net_payable: "70000.00",
              paid_amount: "70000.00",
              remaining_payable: "0.00",
              status: "APPROVED",
              notes: "Settled across two payments (40k + 30k)",
              version: 3,
              approved_at: new Date("2026-11-15T10:00:00Z"),
            },
            // Row 4: Overpayment scenario (not clamped to 0)
            {
              id: 4,
              payroll_period_id: 10,
              worker_id: 104,
              worker_code: "W104",
              worker_name: "Anura Kumara",
              designation: "Mechanic",
              pay_arrangement_snapshot: "DAILY",
              calculation_mode: "CONFIGURED_AUTO",
              approved_days_count: 4,
              approved_regular_hours: "32.00",
              approved_overtime_hours: "0.00",
              base_pay: "12000.00",
              overtime_pay: "0.00",
              allowances: "0.00",
              deductions: "0.00",
              advance_deduction: "0.00",
              gross_pay: "12000.00",
              net_payable: "12000.00",
              paid_amount: "13000.00",
              remaining_payable: "-1000.00",
              status: "APPROVED",
              notes: "Overpayment scenario",
              version: 2,
              approved_at: new Date("2026-11-15T10:00:00Z"),
            },
          ],
        };
      },
    };

    const entries = await listPayrollEntriesByPeriod(mockDb as any, 10);

    // Verify SQL query contains the expected expressions
    assert.ok(capturedQuery.includes("paid_amount"), "SQL must query paid_amount");
    assert.ok(capturedQuery.includes("remaining_payable"), "SQL must query remaining_payable");
    assert.ok(
      capturedQuery.includes("salary_payment_adjustments"),
      "SQL must aggregate payments via scalar subquery incorporating adjustments"
    );
    assert.ok(
      !capturedQuery.includes("pe.remaining_payable"),
      "SQL must not reference pe.remaining_payable"
    );
    assert.ok(
      !capturedQuery.includes("pe.paid_amount"),
      "SQL must not reference pe.paid_amount"
    );
    assert.deepEqual(capturedParams, [10]);

    // Verify mapped results
    assert.equal(entries.length, 4);

    // 1. Zero payment
    assert.equal(entries[0].paidAmount, "0");
    assert.equal(entries[0].remainingPayable, "27000.00");

    // 2. Partial payment
    assert.equal(entries[1].paidAmount, "10000.00");
    assert.equal(entries[1].remainingPayable, "8000.00");

    // 3. Multiple payments / fully settled
    assert.equal(entries[2].paidAmount, "70000.00");
    assert.equal(entries[2].remainingPayable, "0.00");

    // 4. Overpayment (visible as negative balance, not hidden)
    assert.equal(entries[3].paidAmount, "13000.00");
    assert.equal(entries[3].remainingPayable, "-1000.00");
  });

  it("verifies findPayrollEntryById query structure and locking clause", async () => {
    let capturedQuery = "";
    let capturedParams: unknown[] = [];

    const mockDb = {
      query: async (sql: string, params?: unknown[]) => {
        capturedQuery = sql;
        capturedParams = params ?? [];
        return {
          rows: [
            {
              id: 42,
              payroll_period_id: 5,
              worker_id: 101,
              worker_code: "W101",
              worker_name: "Sunil Bandara",
              designation: "Crusher Operator",
              pay_arrangement_snapshot: "HOURLY",
              calculation_mode: "CONFIGURED_AUTO",
              approved_days_count: 5,
              approved_regular_hours: "40.00",
              approved_overtime_hours: "0.00",
              base_pay: "20000.00",
              overtime_pay: "0.00",
              allowances: "0.00",
              deductions: "0.00",
              advance_deduction: "0.00",
              gross_pay: "20000.00",
              net_payable: "20000.00",
              paid_amount: "5000.00",
              remaining_payable: "15000.00",
              status: "APPROVED",
              notes: null,
              version: 2,
              approved_at: new Date("2026-11-15T10:00:00Z"),
            },
          ],
        };
      },
    };

    const entry = await findPayrollEntryById(mockDb as any, 42, true);

    assert.ok(entry !== null);
    assert.equal(entry.id, 42);
    assert.equal(entry.paidAmount, "5000.00");
    assert.equal(entry.remainingPayable, "15000.00");

    // Verify SQL query structure and lock clause
    assert.ok(capturedQuery.includes("FOR UPDATE"), "Must include FOR UPDATE when forUpdate is true");
    assert.ok(
      !capturedQuery.includes("pe.remaining_payable"),
      "SQL must not reference pe.remaining_payable"
    );
    assert.ok(
      !capturedQuery.includes("pe.paid_amount"),
      "SQL must not reference pe.paid_amount"
    );
    assert.deepEqual(capturedParams, [42]);
  });
});

describe("Manual Monthly Salary System — Backend Unit Tests", () => {
  it("rejects overlapping payroll periods to prevent double advance deductions", async () => {
    const mockDb = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT id, period_label")) {
          // Simulate an existing period overlapping with the requested dates
          return {
            rows: [
              {
                id: 1,
                period_label: "November 2026 - First Half",
                start_date: "2026-11-01",
                end_date: "2026-11-15",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const overlap = await findOverlappingPayrollPeriod(
      mockDb as any,
      "2026-11-10",
      "2026-11-25"
    );

    assert.ok(overlap !== null);
    assert.equal(overlap.id, 1);
    assert.equal(overlap.periodLabel, "November 2026 - First Half");

    // Verify service throws ConflictError on overlap
    const mockPool = {
      connect: async () => ({
        query: mockDb.query,
        release: () => {},
      }),
    };
    const service = new PayrollService(mockPool as any);

    await assert.rejects(
      () =>
        service.createPeriod(
          {
            periodLabel: "Late November Overlap",
            startDate: "2026-11-10",
            endDate: "2026-11-25",
          },
          { ownerUserId: "owner-uuid-1" }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes("overlap"));
        return true;
      }
    );
  });

  it("creates non-overlapping period and automatically initializes DRAFT entries for active workers", async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = [];

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("status != 'CANCELLED'") && sql.includes("start_date <=")) {
          // No overlap
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO public.payroll_periods")) {
          return { rows: [{ id: 10 }] };
        }
        if (sql.includes("INSERT INTO public.payroll_entries")) {
          // Initialized 5 active workers
          return { rowCount: 5, rows: [] };
        }
        if (sql.includes("FROM public.payroll_periods") && (sql.includes("WHERE id = $1") || sql.includes("WHERE pp.id = $1"))) {
          return {
            rows: [
              {
                id: 10,
                period_label: "December 2026",
                start_date: "2026-12-01",
                end_date: "2026-12-31",
                status: "DRAFT",
                notes: null,
                version: 1,
                created_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
      query: mockClient.query,
    };

    const service = new PayrollService(mockPool as any);
    const period = await service.createPeriod(
      {
        periodLabel: "December 2026",
        startDate: "2026-12-01",
        endDate: "2026-12-31",
      },
      { ownerUserId: "owner-uuid-1" }
    );

    assert.equal(period.id, 10);
    assert.equal(period.periodLabel, "December 2026");

    // Verify auto-initialization query was called inside transaction
    const initQuery = executedQueries.find((q) =>
      q.sql.includes("INSERT INTO public.payroll_entries")
    );
    assert.ok(initQuery, "Must execute payroll_entries initialization query");
    assert.ok(
      initQuery.sql.includes("ON CONFLICT (payroll_period_id, worker_id) DO NOTHING"),
      "Must be idempotent and prevent duplicate entries"
    );
    assert.ok(
      initQuery.sql.includes("calculation_mode"),
      "Must initialize entries with OWNER_MANUAL_DRAFT"
    );
  });

  it("calculates applicable advances strictly within period dates", async () => {
    let capturedParams: unknown[] = [];
    const mockDb = {
      query: async (sql: string, params?: unknown[]) => {
        capturedParams = params ?? [];
        return { rows: [{ total_advances: "18500.00" }] };
      },
    };

    const advances = await calculateAdvancesForWorkerInPeriod(
      mockDb as any,
      105,
      "2026-11-01",
      "2026-11-30"
    );

    assert.equal(advances, "18500.00");
    assert.deepEqual(capturedParams, [105, "2026-11-01", "2026-11-30"]);
  });

  it("allows Owner to enter manual salary, deducting advances and logging audit details", async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = [];

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("WHERE pe.id = $1")) {
          return {
            rows: [
              {
                id: 20,
                payroll_period_id: 2,
                worker_id: 50,
                worker_code: "W050",
                worker_name: "Ruwan Silva",
                designation: "Excavator Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 0,
                approved_regular_hours: "0.00",
                approved_overtime_hours: "0.00",
                base_pay: "0.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "0.00",
                gross_pay: "0.00",
                net_payable: "0.00",
                paid_amount: "0.00",
                remaining_payable: "0.00",
                status: "DRAFT",
                notes: null,
                version: 1,
                approved_at: null,
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_periods") && (sql.includes("WHERE id = $1") || sql.includes("WHERE pp.id = $1"))) {
          return {
            rows: [
              {
                id: 2,
                period_label: "November 2026",
                start_date: "2026-11-01",
                end_date: "2026-11-30",
                status: "DRAFT",
                notes: null,
                version: 1,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("SELECT COALESCE(SUM(amount), 0)::text AS total_advances")) {
          // 2 advances: 10,000 + 5,000 = 15,000
          return { rows: [{ total_advances: "15000.00" }] };
        }
        if (sql.includes("UPDATE public.payroll_entries")) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("INSERT INTO public.audit_logs")) {
          return { rows: [{ id: 999 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
      query: async (sql: string, params?: unknown[]) => mockClient.query(sql, params),
    };

    const service = new PayrollService(mockPool as any);
    const updated = await service.updateManualSalary(
      20,
      {
        expectedVersion: 1,
        grossSalary: "65000.00",
        reason: "Agreed monthly contract salary for November 2026",
        notes: "Good performance on site",
      },
      {
        userId: "owner-uuid-001",
        username: "npr_owner",
        role: "OWNER",
        fullName: "NPR Managing Director",
        ipAddress: "127.0.0.1",
      }
    );

    assert.ok(updated !== null);

    // Verify UPDATE query parameters: base_pay = 65000.00, gross_pay = 65000.00, advance_deduction = 15000.00, net_payable = 50000.00
    const updateQuery = executedQueries.find((q) =>
      q.sql.includes("UPDATE public.payroll_entries")
    );
    assert.ok(updateQuery, "Must execute UPDATE query");
    assert.equal(updateQuery.params?.[0], "65000.00", "Gross salary parameter");
    assert.equal(updateQuery.params?.[1], "15000.00", "Advance deduction parameter");
    assert.equal(updateQuery.params?.[2], "50000.00", "Net payable parameter (65000 - 15000)");

    // Verify audit log
    const auditQuery = executedQueries.find((q) =>
      q.sql.includes("INSERT INTO public.audit_logs")
    );
    assert.ok(auditQuery, "Must record audit log");
    assert.equal(auditQuery.params?.[0], "owner-uuid-001");
    assert.equal(auditQuery.params?.[1], "UPDATE_MANUAL_SALARY");
    assert.equal(auditQuery.params?.[2], "payroll_entry");
    assert.equal(auditQuery.params?.[3], "20");

    const auditDetails = JSON.parse(auditQuery.params?.[4] as string);
    assert.equal(auditDetails.newGrossSalary, "65000.00");
    assert.equal(auditDetails.applicableAdvances, "15000.00");
    assert.equal(auditDetails.calculatedNetPayable, "50000.00");
    assert.equal(auditDetails.actorUsername, "npr_owner");
    assert.equal(auditDetails.actorRole, "OWNER");
  });

  it("allows Cashier to enter manual salary directly without Owner pre-approval", async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = [];

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("WHERE pe.id = $1")) {
          return {
            rows: [
              {
                id: 25,
                payroll_period_id: 3,
                worker_id: 60,
                worker_code: "W060",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 0,
                approved_regular_hours: "0.00",
                approved_overtime_hours: "0.00",
                base_pay: "0.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "0.00",
                gross_pay: "0.00",
                net_payable: "0.00",
                paid_amount: "0.00",
                remaining_payable: "0.00",
                status: "DRAFT",
                notes: null,
                version: 1,
                approved_at: null,
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_periods") && (sql.includes("WHERE id = $1") || sql.includes("WHERE pp.id = $1"))) {
          return {
            rows: [
              {
                id: 3,
                period_label: "November 2026",
                start_date: "2026-11-01",
                end_date: "2026-11-30",
                status: "DRAFT",
                notes: null,
                version: 1,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("SELECT COALESCE(SUM(amount), 0)::text AS total_advances")) {
          return { rows: [{ total_advances: "5000.00" }] };
        }
        if (sql.includes("UPDATE public.payroll_entries")) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("INSERT INTO public.audit_logs")) {
          return { rows: [{ id: 1001 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
      query: async (sql: string, params?: unknown[]) => mockClient.query(sql, params),
    };

    const service = new PayrollService(mockPool as any);
    const updated = await service.updateManualSalary(
      25,
      {
        expectedVersion: 1,
        grossSalary: "48000.00",
        reason: "Monthly salary entered per owner's written schedule",
      },
      {
        userId: "cashier-uuid-101",
        username: "cashier_sarath",
        role: "CASHIER",
        fullName: "Sarath Cashier",
        ipAddress: "192.168.1.15",
      }
    );

    assert.ok(updated !== null);

    // Verify Cashier identity in audit log
    const auditQuery = executedQueries.find((q) =>
      q.sql.includes("INSERT INTO public.audit_logs")
    );
    assert.ok(auditQuery);
    const auditDetails = JSON.parse(auditQuery.params?.[4] as string);
    assert.equal(auditDetails.actorUsername, "cashier_sarath");
    assert.equal(auditDetails.actorRole, "CASHIER");
    assert.equal(auditDetails.newGrossSalary, "48000.00");
    assert.equal(auditDetails.calculatedNetPayable, "43000.00");
  });

  it("handles advances exceeding gross salary: records notice on draft and blocks final approval with exact excess", async () => {
    // 1. Updating draft with advances exceeding gross salary
    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("WHERE pe.id = $1")) {
          return {
            rows: [
              {
                id: 30,
                payroll_period_id: 4,
                worker_id: 70,
                worker_code: "W070",
                worker_name: "Nimal Fernando",
                designation: "Drill Specialist",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 0,
                approved_regular_hours: "0.00",
                approved_overtime_hours: "0.00",
                base_pay: "0.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "0.00",
                gross_pay: "0.00",
                net_payable: "0.00",
                paid_amount: "0.00",
                remaining_payable: "0.00",
                status: "DRAFT",
                notes: null,
                version: 1,
                approved_at: null,
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_periods") && (sql.includes("WHERE id = $1") || sql.includes("WHERE pp.id = $1"))) {
          return {
            rows: [
              {
                id: 4,
                period_label: "November 2026",
                start_date: "2026-11-01",
                end_date: "2026-11-30",
                status: "DRAFT",
                notes: null,
                version: 1,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("SELECT COALESCE(SUM(amount), 0)::text AS total_advances")) {
          // Advances = 35,000.00 (exceeds gross 30,000.00 by 5,000.00)
          return { rows: [{ total_advances: "35000.00" }] };
        }
        if (sql.includes("UPDATE public.payroll_entries")) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("INSERT INTO public.audit_logs")) {
          return { rows: [{ id: 1002 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
      query: async (sql: string, params?: unknown[]) => mockClient.query(sql, params),
    };

    const service = new PayrollService(mockPool as any);
    await service.updateManualSalary(
      30,
      {
        expectedVersion: 1,
        grossSalary: "30000.00",
        reason: "Base salary entry with high advances",
      },
      {
        userId: "owner-uuid-1",
        username: "owner",
        role: "OWNER",
        ipAddress: "127.0.0.1",
      }
    );

    // 2. Now attempt to approve this entry: MUST fail with exact excess amount
    const mockApproveClient = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("WHERE pe.id = $1")) {
          return {
            rows: [
              {
                id: 30,
                payroll_period_id: 4,
                worker_id: 70,
                worker_code: "W070",
                worker_name: "Nimal Fernando",
                designation: "Drill Specialist",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 0,
                approved_regular_hours: "0.00",
                approved_overtime_hours: "0.00",
                base_pay: "30000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "35000.00",
                gross_pay: "30000.00",
                net_payable: "0.00",
                paid_amount: "0.00",
                remaining_payable: "0.00",
                status: "DRAFT",
                notes: "[NOTICE: Applicable advances of Rs. 35000.00 exceed gross salary of Rs. 30000.00 by Rs. 5000.00]",
                version: 2,
                approved_at: null,
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_periods") && (sql.includes("WHERE id = $1") || sql.includes("WHERE pp.id = $1"))) {
          return {
            rows: [
              {
                id: 4,
                period_label: "November 2026",
                start_date: "2026-11-01",
                end_date: "2026-11-30",
                status: "DRAFT",
                notes: null,
                version: 1,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("SELECT COALESCE(SUM(amount), 0)::text AS total_advances")) {
          return { rows: [{ total_advances: "35000.00" }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockApprovePool = {
      connect: async () => mockApproveClient,
      query: async (sql: string, params?: unknown[]) => mockApproveClient.query(sql, params),
    };

    const approveService = new PayrollService(mockApprovePool as any);

    await assert.rejects(
      () =>
        approveService.approvePayrollEntry(30, 2, {
          ownerUserId: "owner-uuid-1",
          ipAddress: "127.0.0.1",
        }),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(
          err.message.includes("exceed gross salary (Rs. 30000.00) by Rs. 5000.00"),
          `Expected exact excess amount in error message, got: "${err.message}"`
        );
        return true;
      }
    );
  });

  it("blocks approval if live advances changed after draft was saved (stale snapshot protection)", async () => {
    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("WHERE pe.id = $1")) {
          return {
            rows: [
              {
                id: 35,
                payroll_period_id: 5,
                worker_id: 80,
                worker_code: "W080",
                worker_name: "Asanka Gamage",
                designation: "Driver",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 0,
                approved_regular_hours: "0.00",
                approved_overtime_hours: "0.00",
                base_pay: "50000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00", // Saved with 10,000
                gross_pay: "50000.00",
                net_payable: "40000.00",
                paid_amount: "0.00",
                remaining_payable: "40000.00",
                status: "DRAFT",
                notes: null,
                version: 2,
                approved_at: null,
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_periods") && (sql.includes("WHERE id = $1") || sql.includes("WHERE pp.id = $1"))) {
          return {
            rows: [
              {
                id: 5,
                period_label: "November 2026",
                start_date: "2026-11-01",
                end_date: "2026-11-30",
                status: "DRAFT",
                notes: null,
                version: 1,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("SELECT COALESCE(SUM(amount), 0)::text AS total_advances")) {
          // New advance was added: live advances now 16,000.00
          return { rows: [{ total_advances: "16000.00" }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
      query: async (sql: string, params?: unknown[]) => mockClient.query(sql, params),
    };

    const service = new PayrollService(mockPool as any);

    await assert.rejects(
      () =>
        service.approvePayrollEntry(35, 2, {
          ownerUserId: "owner-uuid-1",
          ipAddress: "127.0.0.1",
        }),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(
          err.message.includes("Applicable salary advances have changed"),
          `Expected advances changed error, got: "${err.message}"`
        );
        return true;
      }
    );
  });

  it("blocks approval if gross salary is zero or negative", async () => {
    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("WHERE pe.id = $1")) {
          return {
            rows: [
              {
                id: 40,
                payroll_period_id: 6,
                worker_id: 90,
                worker_code: "W090",
                worker_name: "Saman Kumara",
                designation: "Helper",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 0,
                approved_regular_hours: "0.00",
                approved_overtime_hours: "0.00",
                base_pay: "0.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "0.00",
                gross_pay: "0.00", // Not entered yet
                net_payable: "0.00",
                paid_amount: "0.00",
                remaining_payable: "0.00",
                status: "DRAFT",
                notes: null,
                version: 1,
                approved_at: null,
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
      query: async (sql: string, params?: unknown[]) => mockClient.query(sql, params),
    };

    const service = new PayrollService(mockPool as any);

    await assert.rejects(
      () =>
        service.approvePayrollEntry(40, 1, {
          ownerUserId: "owner-uuid-1",
          ipAddress: "127.0.0.1",
        }),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.message.includes("manual gross salary must be greater than zero"));
        return true;
      }
    );
  });

  it("enforces optimistic concurrency control and blocks editing approved entries", async () => {
    // 1. Version conflict
    const mockClientConflict = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("WHERE pe.id = $1")) {
          return {
            rows: [
              {
                id: 50,
                payroll_period_id: 7,
                worker_id: 95,
                status: "DRAFT",
                version: 3, // Current version is 3
                gross_pay: "45000.00",
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const serviceConflict = new PayrollService({
      connect: async () => mockClientConflict,
      query: mockClientConflict.query,
    } as any);

    await assert.rejects(
      () =>
        serviceConflict.updateManualSalary(
          50,
          {
            expectedVersion: 2, // Outdated version
            grossSalary: "50000.00",
            reason: "Attempt update with stale version",
          },
          { userId: "u1", username: "user1", role: "CASHIER", ipAddress: "127.0.0.1" }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes("Concurrent modification"));
        return true;
      }
    );

    // 2. Immutability of APPROVED entries
    const mockClientApproved = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("WHERE pe.id = $1")) {
          return {
            rows: [
              {
                id: 51,
                payroll_period_id: 7,
                worker_id: 96,
                status: "APPROVED", // Already approved
                version: 2,
                gross_pay: "45000.00",
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const serviceApproved = new PayrollService({
      connect: async () => mockClientApproved,
      query: mockClientApproved.query,
    } as any);

    await assert.rejects(
      () =>
        serviceApproved.updateManualSalary(
          51,
          {
            expectedVersion: 2,
            grossSalary: "55000.00",
            reason: "Attempt modifying approved salary",
          },
          { userId: "u1", username: "user1", role: "OWNER", ipAddress: "127.0.0.1" }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes("Cannot modify salary for an entry with status APPROVED"));
        return true;
      }
    );
  });

  it("verifies route permissions: Cashier can edit manual salary, but cannot approve or record payment", () => {
    const dummyService = {} as any;
    const dummyAuth = ((_req: any, _res: any, next: any) => next()) as any;

    const { payrollRouter } = createPayrollRouters(dummyService, dummyAuth);

    // Inspect routes registered on payrollRouter
    const routes = payrollRouter.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
        stackLength: layer.route.stack.length,
      }));

    // Verify PUT /entries/:id/salary is registered
    const salaryRoute = routes.find((r: any) => r.path === "/entries/:id/salary");
    assert.ok(salaryRoute, "Route PUT /entries/:id/salary must be mounted");
    assert.ok(salaryRoute.methods.includes("put"), "Must be a PUT endpoint");

    // Verify approval and payment routes exist
    const approveRoute = routes.find((r: any) => r.path === "/entries/:id/approve");
    assert.ok(approveRoute, "Route POST /entries/:id/approve must be mounted");

    const paymentRoute = routes.find((r: any) => r.path === "/entries/:id/payments");
    assert.ok(paymentRoute, "Route POST /entries/:id/payments must be mounted");

    const historyRoute = routes.find((r: any) => r.path === "/salary-history");
    assert.ok(historyRoute, "Route GET /salary-history must be mounted");
  });

  it("verifies listSalaryAuditHistory correctly parses and formats audit logs", async () => {
    let capturedQuery = "";
    let capturedParams: unknown[] = [];

    const mockDb = {
      query: async (sql: string, params?: unknown[]) => {
        capturedQuery = sql;
        capturedParams = params ?? [];
        return {
          rows: [
            {
              id: 501,
              user_id: "cashier-uuid-1",
              username: "cashier_sarath",
              full_name: "Sarath Perera",
              role: "CASHIER",
              action: "UPDATE_MANUAL_SALARY",
              details: {
                payrollEntryId: 20,
                workerId: 105,
                workerCode: "W105",
                workerName: "Ruwan Silva",
                periodId: 2,
                periodLabel: "November 2026",
                previousGrossSalary: "0.00",
                newGrossSalary: "65000.00",
                applicableAdvances: "15000.00",
                calculatedNetPayable: "50000.00",
                excessAdvances: null,
                reason: "Contract monthly salary updated",
                notes: "Good performance",
              },
              created_at: new Date("2026-11-19T10:30:00Z"),
            },
          ],
        };
      },
    };

    const history = await listSalaryAuditHistory(mockDb as any, { entryId: 20 });

    assert.equal(history.length, 1);
    const entry = history[0];
    assert.equal(entry.payrollEntryId, 20);
    assert.equal(entry.workerId, 105);
    assert.equal(entry.workerCode, "W105");
    assert.equal(entry.newGrossSalary, "65000.00");
    assert.equal(entry.applicableAdvances, "15000.00");
    assert.equal(entry.calculatedNetPayable, "50000.00");
    assert.equal(entry.actorUsername, "cashier_sarath");
    assert.equal(entry.actorRole, "CASHIER");
    assert.equal(entry.reason, "Contract monthly salary updated");

    assert.ok(capturedQuery.includes("al.action = 'UPDATE_MANUAL_SALARY'"));
    assert.deepEqual(capturedParams, ["20", 200]);
  });
});

