import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import {
  findActiveMaterialsWithVehiclePrices,
  listMaterialVehiclePriceHistory,
} from "../modules/materials/materials.repository.js";
import { MaterialsService } from "../modules/materials/materials.service.js";
import type { VehicleCategory } from "../modules/materials/materials.types.js";
import {
  findInvoiceDetailById,
  listIssuedInvoices,
} from "../modules/invoices/invoices.repository.js";
import { InvoicesService } from "../modules/invoices/invoices.service.js";
import { computeLineTotalCents, formatScaledDecimal, parseScaledDecimal } from "../utils/money.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Vehicle-Specific Material Pricing & ft³ Invoicing — Unit & Migration Tests", () => {
  const CASHIER_USER_ID = "c0000000-0000-0000-0000-000000000001";
  const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";

  // ===========================================================================
  // 1. MIGRATION 015 SQL STRUCTURE & IMMUTABILITY AUDIT
  // ===========================================================================
  it("verifies migration 015 SQL structure, forward-only header, tables, triggers, and RLS", async () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../database/migrations/015_vehicle_ft3_pricing.sql"
    );
    const sql = await readFile(migrationPath, "utf8");

    // Forward-only enforcement
    assert.match(sql, /--\s*Up Migration/i);
    assert.doesNotMatch(sql, /--\s*Down Migration/i);

    // material_vehicle_prices table definition & constraints
    assert.match(sql, /CREATE\s+TABLE\s+material_vehicle_prices/i);
    assert.match(sql, /vehicle_category\s+VARCHAR\(20\)\s+NOT\s+NULL\s+CHECK\s*\(vehicle_category\s+IN\s*\('TRACTOR',\s*'TIPPER'\)\)/i);
    assert.match(sql, /price_per_ft3\s+NUMERIC\(12,\s*2\)\s+CHECK\s*\(price_per_ft3\s+IS\s+NULL\s+OR\s+price_per_ft3\s*>=\s*0\.00\)/i);
    assert.match(sql, /version\s+INT\s+NOT\s+NULL\s+DEFAULT\s+1\s+CHECK\s*\(version\s*>=\s*1\)/i);
    assert.match(sql, /CONSTRAINT\s+uq_material_vehicle_prices\s+UNIQUE\s*\(material_id,\s*vehicle_category\)/i);
    assert.match(sql, /CREATE\s+TRIGGER\s+trg_material_vehicle_prices_set_updated_at/i);

    // material_vehicle_price_history append-only & actor triggers
    assert.match(sql, /CREATE\s+TABLE\s+material_vehicle_price_history/i);
    assert.match(sql, /CREATE\s+TRIGGER\s+trg_mat_veh_price_history_append_only/i);
    assert.match(sql, /forbid_append_only_mutation\(\)/);
    assert.match(sql, /CREATE\s+TRIGGER\s+trg_mat_veh_price_history_actor/i);
    assert.match(sql, /enforce_price_history_owner\(\)/);

    // Invoice snapshot columns
    assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+vehicle_category/i);
    assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+unit_snapshot/i);
    assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+unit_snapshot/i);
    assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+vehicle_category_snapshot/i);

    // Immutability in enforce_invoice_before_update
    assert.match(sql, /NEW\.vehicle_category\s+IS\s+DISTINCT\s+FROM\s+OLD\.vehicle_category/);
    assert.match(sql, /NEW\.unit_snapshot\s+IS\s+DISTINCT\s+FROM\s+OLD\.unit_snapshot/);

    // Initial seeding cross-join with NULL prices
    assert.match(sql, /INSERT\s+INTO\s+material_vehicle_prices/i);
    assert.match(sql, /CROSS\s+JOIN\s+\(VALUES\s*\('TRACTOR'::varchar\(20\)\),\s*\('TIPPER'::varchar\(20\)\)\)/i);
    assert.match(sql, /ON\s+CONFLICT\s*\(material_id,\s*vehicle_category\)\s+DO\s+NOTHING/i);

    // RLS & runtime role configuration
    assert.match(sql, /ALTER\s+TABLE\s+public\.material_vehicle_prices\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    assert.match(sql, /ALTER\s+TABLE\s+public\.material_vehicle_price_history\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    assert.match(sql, /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.material_vehicle_prices,\s*public\.material_vehicle_price_history\s+FROM\s+PUBLIC/i);
    assert.match(sql, /GRANT\s+SELECT,\s*INSERT,\s*UPDATE\s+ON\s+public\.material_vehicle_prices\s+TO\s+npr_app_user/i);
    assert.match(sql, /GRANT\s+SELECT,\s*INSERT\s+ON\s+public\.material_vehicle_price_history\s+TO\s+npr_app_user/i);
  });

  // ===========================================================================
  // 2. MATERIALS SERVICE — INDEPENDENT VEHICLE PRICING & VERSIONING
  // ===========================================================================
  it("permits Cashier to update TRACTOR price for active material with valid reason and version", async () => {
    let priceUpdated = false;
    let historyInserted = false;
    let auditLogged = false;

    const mockClient = {
      query: async (sqlText: string, params?: any[]) => {
        if (typeof sqlText === "string" && sqlText.includes("FROM public.material_vehicle_prices mvp") && sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 1,
                material_id: 1,
                vehicle_category: "TRACTOR",
                price_per_ft3: "250.00",
                version: 2,
                updated_at: new Date(),
                material_name: "3/4 Metal",
                material_code: "3/4",
                material_is_active: true,
              },
            ],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("UPDATE public.material_vehicle_prices")) {
          priceUpdated = true;
          return {
            rows: [
              {
                id: 1,
                material_id: 1,
                vehicle_category: "TRACTOR",
                price_per_ft3: params?.[0],
                version: 3,
                updated_at: new Date(),
              },
            ],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("INSERT INTO public.material_vehicle_price_history")) {
          historyInserted = true;
          assert.equal(params?.[0], 1); // material_id
          assert.equal(params?.[1], "TRACTOR"); // vehicle_category
          assert.equal(params?.[2], "250.00"); // oldPrice
          assert.equal(params?.[3], "265.00"); // newPrice
          assert.equal(params?.[4], 2); // oldVersion
          assert.equal(params?.[5], 3); // newVersion
          assert.equal(params?.[6], CASHIER_USER_ID); // changedByUserId
          assert.equal(params?.[7], "Diesel and extraction cost hike"); // reason
          return { rows: [] };
        }
        if (typeof sqlText === "string" && sqlText.includes("INSERT INTO public.audit_logs")) {
          auditLogged = true;
          return { rows: [] };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.materials m")) {
          return {
            rows: [
              {
                id: 1,
                code: "3/4",
                name: "3/4 Metal",
                unit: "m³",
                current_unit_price: "9000.00",
                is_active: true,
                version: 1,
                updated_at: new Date(),
                vehicle_prices: [
                  { vehicleCategory: "TRACTOR", pricePerFt3: "265.00", version: 3, updatedAt: new Date().toISOString() },
                  { vehicleCategory: "TIPPER", pricePerFt3: "240.00", version: 1, updatedAt: new Date().toISOString() },
                ],
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
      query: async (sqlText: string, params?: any[]) => mockClient.query(sqlText, params),
    } as any;

    const service = new MaterialsService(mockPool);
    const result = await service.updatePrice(
      {
        materialId: 1,
        vehicleCategory: "TRACTOR",
        newPrice: "265.00",
        reason: "Diesel and extraction cost hike",
        expectedVersion: 2,
      },
      {
        userId: CASHIER_USER_ID,
        username: "cashier1",
        role: "CASHIER",
        ipAddress: "127.0.0.1",
      }
    );

    assert.ok(priceUpdated, "Must execute UPDATE on material_vehicle_prices");
    assert.ok(historyInserted, "Must insert append-only history record into material_vehicle_price_history");
    assert.ok(auditLogged, "Must log event in audit_logs");
    assert.equal(result.tractorPricePerFt3, "265.00");
    assert.equal(result.tipperPricePerFt3, "240.00");
    assert.equal(result.vehiclePrices?.TRACTOR?.version, 3);
  });

  it("rejects vehicle price update on optimistic version conflict", async () => {
    const mockClient = {
      query: async (sqlText: string) => {
        if (typeof sqlText === "string" && sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 1,
                material_id: 1,
                vehicle_category: "TIPPER",
                price_per_ft3: "240.00",
                version: 4, // Current in DB is 4
                updated_at: new Date(),
                material_name: "3/4 Metal",
                material_code: "3/4",
                material_is_active: true,
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient } as any;
    const service = new MaterialsService(mockPool);

    await assert.rejects(
      async () => {
        await service.updatePrice(
          {
            materialId: 1,
            vehicleCategory: "TIPPER",
            newPrice: "250.00",
            reason: "Stale update attempt",
            expectedVersion: 2, // Stale expected version
          },
          { userId: CASHIER_USER_ID, role: "CASHIER", ipAddress: "127.0.0.1" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.equal(err.code, "VERSION_CONFLICT");
        assert.match(err.message, /modified by another session/i);
        return true;
      }
    );
  });

  it("blocks Cashier from updating vehicle price of an inactive material", async () => {
    const mockClient = {
      query: async (sqlText: string) => {
        if (typeof sqlText === "string" && sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 2,
                material_id: 2,
                vehicle_category: "TRACTOR",
                price_per_ft3: null,
                version: 1,
                updated_at: new Date(),
                material_name: "Chip",
                material_code: "CHIP",
                material_is_active: false, // Inactive material
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient } as any;
    const service = new MaterialsService(mockPool);

    await assert.rejects(
      async () => {
        await service.updatePrice(
          {
            materialId: 2,
            vehicleCategory: "TRACTOR",
            newPrice: "310.00",
            reason: "Attempting cashier price update on inactive product",
            expectedVersion: 1,
          },
          { userId: CASHIER_USER_ID, role: "CASHIER", ipAddress: "127.0.0.1" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Cashiers can only update prices for active materials/i);
        return true;
      }
    );
  });

  it("blocks Cashier from modifying material active status", async () => {
    const mockClient = {
      query: async (sqlText: string) => {
        if (typeof sqlText === "string" && sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 1,
                material_id: 1,
                vehicle_category: "TRACTOR",
                price_per_ft3: "250.00",
                version: 1,
                updated_at: new Date(),
                material_name: "3/4 Metal",
                material_code: "3/4",
                material_is_active: true,
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient } as any;
    const service = new MaterialsService(mockPool);

    await assert.rejects(
      async () => {
        await service.updatePrice(
          {
            materialId: 1,
            vehicleCategory: "TRACTOR",
            newPrice: "260.00",
            reason: "Cashier attempting to deactivate product",
            expectedVersion: 1,
            isActive: false, // Cashier passing isActive
          },
          { userId: CASHIER_USER_ID, role: "CASHIER", ipAddress: "127.0.0.1" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Only Owner accounts are permitted to activate or deactivate materials/i);
        return true;
      }
    );
  });

  it("permits Owner to configure vehicle price and activate material", async () => {
    let statusUpdated = false;
    let priceUpdated = false;

    const mockClient = {
      query: async (sqlText: string, params?: any[]) => {
        if (typeof sqlText === "string" && sqlText.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 5,
                material_id: 5,
                vehicle_category: "TRACTOR",
                price_per_ft3: null,
                version: 1,
                updated_at: new Date(),
                material_name: "SubBase",
                material_code: "SUBBASE",
                material_is_active: false,
              },
            ],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("UPDATE public.materials") && sqlText.includes("SET is_active = $1")) {
          statusUpdated = true;
          assert.equal(params?.[0], true);
          return { rows: [{ id: 5, is_active: true, version: 2 }] };
        }
        if (typeof sqlText === "string" && sqlText.includes("UPDATE public.material_vehicle_prices")) {
          priceUpdated = true;
          return {
            rows: [
              {
                id: 5,
                material_id: 5,
                vehicle_category: "TRACTOR",
                price_per_ft3: "220.00",
                version: 2,
                updated_at: new Date(),
              },
            ],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.materials m")) {
          return {
            rows: [
              {
                id: 5,
                code: "SUBBASE",
                name: "SubBase",
                unit: "m³",
                current_unit_price: "0.00",
                is_active: true,
                version: 2,
                updated_at: new Date(),
                vehicle_prices: [
                  { vehicleCategory: "TRACTOR", pricePerFt3: "220.00", version: 2, updatedAt: new Date().toISOString() },
                  { vehicleCategory: "TIPPER", pricePerFt3: null, version: 1, updatedAt: new Date().toISOString() },
                ],
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
      query: async (sqlText: string, params?: any[]) => mockClient.query(sqlText, params),
    } as any;

    const service = new MaterialsService(mockPool);
    const result = await service.updatePrice(
      {
        materialId: 5,
        vehicleCategory: "TRACTOR",
        newPrice: "220.00",
        reason: "Owner initial pricing and product activation",
        expectedVersion: 1,
        isActive: true,
      },
      {
        userId: OWNER_USER_ID,
        role: "OWNER",
        ipAddress: "127.0.0.1",
      }
    );

    assert.ok(statusUpdated, "Owner must be able to update active status");
    assert.ok(priceUpdated, "Owner must be able to update vehicle price");
    assert.equal(result.isActive, true);
    assert.equal(result.tractorPricePerFt3, "220.00");
  });

  // ===========================================================================
  // 3. INVOICES SERVICE — TRACTOR & TIPPER ISSUANCE IN FT³
  // ===========================================================================
  it("issues invoice for TRACTOR: pulls tractor Rs./ft³ price and computes line totals with exact scaled-integer math", async () => {
    let draftVehicleCategory: string | null = null;
    let draftUnitSnapshot: string | null = null;
    let itemUnitSnapshot: string | null = null;
    let itemVehicleSnapshot: string | null = null;
    let finalizedSubtotal: string | null = null;
    let finalizedGrandTotal: string | null = null;

    const mockClient = {
      query: async (sqlText: string, params?: any[]) => {
        // Advisory lock
        if (typeof sqlText === "string" && sqlText.includes("pg_advisory_xact_lock")) {
          return { rows: [] };
        }
        // Idempotency check
        if (typeof sqlText === "string" && sqlText.includes("FROM public.idempotency_records")) {
          return { rows: [] };
        }
        // Customer lookup
        if (typeof sqlText === "string" && sqlText.toLowerCase().includes("customers")) {
          return {
            rows: [
              {
                id: 10,
                name: "Gamini Construction",
                phone: "0771234567",
                location: "Mirigama",
              },
            ],
          };
        }
        // Active materials with vehicle prices lookup
        if (typeof sqlText === "string" && sqlText.includes("FROM public.materials m") && sqlText.includes("material_vehicle_prices")) {
          assert.equal(params?.[1], "TRACTOR");
          return {
            rows: [
              {
                id: 1,
                code: "3/4",
                name: "3/4 Metal",
                unit: "m³",
                current_unit_price: "9000.00",
                is_active: true,
                version: 1,
                updated_at: new Date(),
                vehicle_category: "TRACTOR",
                price_per_ft3: "250.00", // Rs. 250.00 per ft³
                vehicle_price_version: 1,
              },
            ],
          };
        }
        // Insert draft invoice
        if (typeof sqlText === "string" && sqlText.includes("INSERT INTO public.invoices")) {
          draftVehicleCategory = params?.[7];
          draftUnitSnapshot = params?.[8];
          return { rows: [{ id: 101, invoice_number: "NPR-INV-000101" }] };
        }
        // Insert invoice item
        if (typeof sqlText === "string" && sqlText.includes("INSERT INTO public.invoice_items")) {
          itemUnitSnapshot = params?.[6];
          itemVehicleSnapshot = params?.[7];
          return { rows: [] };
        }
        // Finalize draft invoice
        if (typeof sqlText === "string" && sqlText.includes("UPDATE public.invoices") && sqlText.includes("status = 'ISSUED'")) {
          finalizedSubtotal = params?.[0];
          finalizedGrandTotal = params?.[1];
          return { rows: [] };
        }
        // Insert idempotency
        if (typeof sqlText === "string" && sqlText.includes("INSERT INTO public.idempotency_records")) {
          return { rows: [] };
        }
        // Audit log
        if (typeof sqlText === "string" && sqlText.includes("INSERT INTO public.audit_logs")) {
          return { rows: [] };
        }
        // Reload persisted invoice
        if (typeof sqlText === "string" && sqlText.includes("FROM public.invoice_ledger_view")) {
          return {
            rows: [
              {
                invoice_id: 101,
                invoice_number: "NPR-INV-000101",
                customer_id: 10,
                customer_name_snapshot: "Gamini Construction",
                customer_phone_snapshot: "0771234567",
                customer_location_snapshot: "Mirigama",
                has_transport: false,
                transport_fee: "0.00",
                subtotal: finalizedSubtotal,
                original_grand_total: finalizedGrandTotal,
                effective_grand_total: finalizedGrandTotal,
                effective_paid: "0.00",
                balance_due: finalizedGrandTotal,
                payment_status: "UNPAID",
                invoice_status: "ISSUED",
                issued_by_user_id: CASHIER_USER_ID,
                issued_by_name: "Cashier One",
                issued_at: new Date(),
                business_date: "2026-11-23",
                vehicle_category: "TRACTOR",
                unit_snapshot: "ft³",
              },
            ],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.invoice_items")) {
          return {
            rows: [
              {
                id: 1,
                material_id: 1,
                material_name_snapshot: "3/4 Metal",
                quantity: "100.000",
                unit_price: "250.00",
                line_total: "25000.00",
                unit_snapshot: "ft³",
                vehicle_category_snapshot: "TRACTOR",
              },
            ],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.payments")) {
          return { rows: [] };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.payment_adjustments")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
      query: async (sqlText: string, params?: any[]) => mockClient.query(sqlText, params),
    } as any;

    const service = new InvoicesService(mockPool);
    const result = await service.issueInvoice(
      {
        customerId: 10,
        vehicleCategory: "TRACTOR",
        items: [{ materialId: 1, quantity: "100.000" }], // 100 ft³ @ Rs. 250.00 = Rs. 25,000.00
        hasTransport: false,
        transportFee: "0.00",
        idempotencyKey: "idem-tractor-test-001",
      },
      { userId: CASHIER_USER_ID, ipAddress: "127.0.0.1" }
    );

    assert.equal(draftVehicleCategory, "TRACTOR");
    assert.equal(draftUnitSnapshot, "ft³");
    assert.equal(itemUnitSnapshot, "ft³");
    assert.equal(itemVehicleSnapshot, "TRACTOR");
    assert.equal(finalizedSubtotal, "25000.00");
    assert.equal(finalizedGrandTotal, "25000.00");
    assert.equal(result.invoice.vehicleCategory, "TRACTOR");
    assert.equal(result.invoice.unitSnapshot, "ft³");
    assert.equal(result.invoice.items[0].unitSnapshot, "ft³");
    assert.equal(result.invoice.items[0].vehicleCategorySnapshot, "TRACTOR");
  });

  it("issues invoice for TIPPER: pulls independent tipper price and preserves transport calculations", async () => {
    let finalizedGrandTotal: string | null = null;

    const mockClient = {
      query: async (sqlText: string, params?: any[]) => {
        if (typeof sqlText === "string" && sqlText.toLowerCase().includes("customers")) {
          return {
            rows: [{ id: 10, name: "Gamini Construction", phone: "0771234567", location: "Mirigama" }],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.materials m") && sqlText.includes("material_vehicle_prices")) {
          assert.equal(params?.[1], "TIPPER");
          return {
            rows: [
              {
                id: 1,
                code: "3/4",
                name: "3/4 Metal",
                unit: "m³",
                current_unit_price: "9000.00",
                is_active: true,
                version: 1,
                updated_at: new Date(),
                vehicle_category: "TIPPER",
                price_per_ft3: "240.00", // Rs. 240.00 per ft³ for TIPPER (vs 250 for tractor)
                vehicle_price_version: 1,
              },
            ],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("INSERT INTO public.invoices")) {
          return { rows: [{ id: 102, invoice_number: "NPR-INV-000102" }] };
        }
        if (typeof sqlText === "string" && sqlText.includes("UPDATE public.invoices") && sqlText.includes("status = 'ISSUED'")) {
          finalizedGrandTotal = params?.[1];
          return { rows: [] };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.invoice_ledger_view")) {
          return {
            rows: [
              {
                invoice_id: 102,
                invoice_number: "NPR-INV-000102",
                customer_id: 10,
                customer_name_snapshot: "Gamini Construction",
                customer_phone_snapshot: "0771234567",
                customer_location_snapshot: "Mirigama",
                has_transport: true,
                transport_fee: "8000.00",
                subtotal: "48000.00",
                original_grand_total: finalizedGrandTotal,
                effective_grand_total: finalizedGrandTotal,
                effective_paid: "0.00",
                balance_due: finalizedGrandTotal,
                payment_status: "UNPAID",
                invoice_status: "ISSUED",
                issued_by_user_id: CASHIER_USER_ID,
                issued_by_name: "Cashier One",
                issued_at: new Date(),
                business_date: "2026-11-23",
                vehicle_category: "TIPPER",
                unit_snapshot: "ft³",
              },
            ],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.invoice_items")) {
          return {
            rows: [
              {
                id: 2,
                material_id: 1,
                material_name_snapshot: "3/4 Metal",
                quantity: "200.000",
                unit_price: "240.00",
                line_total: "48000.00",
                unit_snapshot: "ft³",
                vehicle_category_snapshot: "TIPPER",
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
      query: async (sqlText: string, params?: any[]) => mockClient.query(sqlText, params),
    } as any;

    const service = new InvoicesService(mockPool);
    const result = await service.issueInvoice(
      {
        customerId: 10,
        vehicleCategory: "TIPPER",
        items: [{ materialId: 1, quantity: "200.000" }], // 200 ft³ @ Rs. 240 = Rs. 48,000 + Rs. 8,000 transport = Rs. 56,000
        hasTransport: true,
        transportFee: "8000.00",
        idempotencyKey: "idem-tipper-test-002",
      },
      { userId: CASHIER_USER_ID, ipAddress: "127.0.0.1" }
    );

    // subtotal = 48,000.00 + transportFee = 8,000.00 -> grandTotal = 56,000.00
    assert.equal(finalizedGrandTotal, "56000.00");
    assert.equal(result.invoice.vehicleCategory, "TIPPER");
    assert.equal(result.invoice.hasTransport, true);
    assert.equal(result.invoice.transportFee, "8000.00");
    assert.equal(result.invoice.grandTotal, "56000.00");
  });

  // ===========================================================================
  // 4. MISSING / UNCONFIGURED PRICE BLOCKING
  // ===========================================================================
  it("blocks invoice creation when material price for the selected vehicle category is unconfigured (NULL)", async () => {
    const mockClient = {
      query: async (sqlText: string) => {
        if (typeof sqlText === "string" && sqlText.toLowerCase().includes("customers")) {
          return {
            rows: [{ id: 10, name: "Gamini Construction", phone: "0771234567", location: "Mirigama" }],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.materials m") && sqlText.includes("material_vehicle_prices")) {
          return {
            rows: [
              {
                id: 1,
                code: "3/4",
                name: "3/4 Metal",
                unit: "m³",
                current_unit_price: "9000.00",
                is_active: true,
                version: 1,
                updated_at: new Date(),
                vehicle_category: "TIPPER",
                price_per_ft3: null, // UNCONFIGURED NULL PRICE
                vehicle_price_version: 1,
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient } as any;
    const service = new InvoicesService(mockPool);

    await assert.rejects(
      async () => {
        await service.issueInvoice(
          {
            customerId: 10,
            vehicleCategory: "TIPPER",
            items: [{ materialId: 1, quantity: "50.000" }],
            hasTransport: false,
            transportFee: "0.00",
            idempotencyKey: "idem-unconfigured-price-test",
          },
          { userId: CASHIER_USER_ID, ipAddress: "127.0.0.1" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /does not have an active price configured for TIPPER/i);
        return true;
      }
    );
  });

  // ===========================================================================
  // 5. UNCHANGED TRANSPORT LOGIC INVARIANTS
  // ===========================================================================
  it("strictly enforces transport fee consistency (fee must be 0.00 when hasTransport is false)", async () => {
    const mockPool = { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) } as any;
    const service = new InvoicesService(mockPool);

    await assert.rejects(
      async () => {
        await service.issueInvoice(
          {
            customerId: 10,
            vehicleCategory: "TRACTOR",
            items: [{ materialId: 1, quantity: "50.000" }],
            hasTransport: false,
            transportFee: "2500.00", // Invalid: non-zero fee with hasTransport=false
            idempotencyKey: "idem-transport-inconsistency",
          },
          { userId: CASHIER_USER_ID, ipAddress: "127.0.0.1" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Transport fee must be 0\.00 when Without Transport is selected/i);
        return true;
      }
    );
  });

  // ===========================================================================
  // 6. IDEMPOTENCY KEY INCLUDES VEHICLE CATEGORY
  // ===========================================================================
  it("includes vehicle category in invoice idempotency hash and rejects conflicting category on identical key", async () => {
    // Generate canonical request hash with vehicleCategory
    const basePayload = {
      customerId: 10,
      items: [{ materialId: 1, quantity: "100.000" }],
      hasTransport: false,
      transportFee: "0.00",
      idempotencyKey: "idem-reused-key-different-category",
    };

    const tractorCanonical = {
      actorUserId: CASHIER_USER_ID,
      customerId: 10,
      customer: null,
      vehicleCategory: "TRACTOR",
      items: [{ materialId: 1, quantity: "100.000" }],
      hasTransport: false,
      transportFee: "0.00",
      initialPaymentAmount: "0",
      initialPaymentNotes: null,
    };
    const tractorHash = createHash("sha256").update(JSON.stringify(tractorCanonical)).digest("hex");

    const mockClient = {
      query: async (sqlText: string) => {
        if (typeof sqlText === "string" && sqlText.includes("FROM public.idempotency_records")) {
          // Existing record has tractorHash
          return {
            rows: [
              {
                operation_type: "ISSUE_INVOICE",
                request_hash: tractorHash,
                actor_user_id: CASHIER_USER_ID,
                response_status: 201,
                response_payload: { invoice: { id: 101 } },
                expires_at: new Date(Date.now() + 86400000),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient } as any;
    const service = new InvoicesService(mockPool);

    // Submitting with vehicleCategory = "TIPPER" using the same idempotency key
    await assert.rejects(
      async () => {
        await service.issueInvoice(
          {
            ...basePayload,
            vehicleCategory: "TIPPER",
          },
          { userId: CASHIER_USER_ID, ipAddress: "127.0.0.1" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.equal(err.code, "IDEMPOTENCY_CONFLICT");
        assert.match(err.message, /Idempotency key has already been used for a different request/i);
        return true;
      }
    );
  });

  // ===========================================================================
  // 7. OLD INVOICE & LINE ITEM BACKWARD COMPATIBILITY
  // ===========================================================================
  it("preserves historical m³ measurements, prices, and null vehicle category for legacy invoices", async () => {
    const mockClient = {
      query: async (sqlText: string) => {
        // Querying invoice header with legacy NULL vehicle_category and unit_snapshot
        if (typeof sqlText === "string" && sqlText.includes("FROM public.invoice_ledger_view")) {
          return {
            rows: [
              {
                invoice_id: 50,
                invoice_number: "NPR-INV-000050",
                customer_id: 5,
                customer_name_snapshot: "Old Customer",
                customer_phone_snapshot: "0770000000",
                customer_location_snapshot: "Gampaha",
                has_transport: false,
                transport_fee: "0.00",
                subtotal: "18000.00",
                original_grand_total: "18000.00",
                effective_grand_total: "18000.00",
                effective_paid: "18000.00",
                balance_due: "0.00",
                payment_status: "PAID",
                invoice_status: "ISSUED",
                issued_by_user_id: CASHIER_USER_ID,
                issued_by_name: "Cashier One",
                issued_at: new Date("2026-01-15T10:00:00Z"),
                business_date: "2026-01-15",
                vehicle_category: null, // Legacy invoices have NULL
                unit_snapshot: null,    // Legacy invoices have NULL
              },
            ],
          };
        }
        // Querying invoice items with legacy NULL unit_snapshot and vehicle_category_snapshot
        if (typeof sqlText === "string" && sqlText.includes("FROM public.invoice_items")) {
          return {
            rows: [
              {
                id: 88,
                material_id: 1,
                material_name_snapshot: "3/4 Metal",
                quantity: "2.000",
                unit_price: "9000.00",
                line_total: "18000.00",
                unit_snapshot: null,
                vehicle_category_snapshot: null,
              },
            ],
          };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.payments")) {
          return { rows: [] };
        }
        if (typeof sqlText === "string" && sqlText.includes("FROM public.payment_adjustments")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const detail = await findInvoiceDetailById(mockClient as any, 50);
    assert.ok(detail, "Legacy invoice must be reloaded cleanly");
    assert.equal(detail.vehicleCategory, null, "Legacy invoice vehicleCategory must be null");
    assert.equal(detail.unitSnapshot, "m³", "Legacy invoice unitSnapshot must default to m³");
    assert.equal(detail.items[0].unitSnapshot, "m³", "Legacy line item unitSnapshot must default to m³");
    assert.equal(detail.items[0].vehicleCategorySnapshot, null, "Legacy line item vehicleCategorySnapshot must be null");
    assert.equal(detail.items[0].quantity, "2.000");
    assert.equal(detail.items[0].unitPrice, "9000.00");
  });
});
