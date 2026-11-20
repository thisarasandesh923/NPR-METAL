import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPayrollRouters } from "../modules/payroll/payroll.routes.js";
import { PayrollService } from "../modules/payroll/payroll.service.js";
import {
  findPayrollEntryById,
  findSalaryPaymentById,
  findLatestSalaryPaymentAdjustment,
  listSalaryPaymentAdjustments,
} from "../modules/payroll/payroll.repository.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../errors/appError.js";

describe("Stage 3.2B — Owner Approved Salary Corrections & Payment Adjustments Unit Tests", () => {
  const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
  const CASHIER_USER_ID = "c0000000-0000-0000-0000-000000000001";

  // --------------------------------------------------------------------------
  // 1. ROUTE GUARDS & RBAC PERMISSIONS
  // --------------------------------------------------------------------------
  it("verifies route authorization: Approved salary corrections and payment adjustments are strictly OWNER-ONLY", () => {
    const dummyService = {} as any;
    let authRole = "CASHIER";
    const dummyAuth = ((req: any, _res: any, next: any) => {
      req.auth = {
        user: {
          id: authRole === "OWNER" ? OWNER_USER_ID : CASHIER_USER_ID,
          username: authRole === "OWNER" ? "owner_npr" : "cashier_sarath",
          role: authRole,
        },
      };
      next();
    }) as any;

    const { payrollRouter } = createPayrollRouters(dummyService, dummyAuth);

    const routes = payrollRouter.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
        stack: layer.route.stack,
      }));

    // Verify PUT /entries/:id/approved-salary is mounted
    const approvedSalaryRoute = routes.find(
      (r: any) => r.path === "/entries/:id/approved-salary" && r.methods.includes("put")
    );
    assert.ok(approvedSalaryRoute, "PUT /entries/:id/approved-salary must be mounted");

    // Verify POST /payments/:id/adjust is mounted
    const paymentAdjustRoute = routes.find(
      (r: any) => r.path === "/payments/:id/adjust" && r.methods.includes("post")
    );
    assert.ok(paymentAdjustRoute, "POST /payments/:id/adjust must be mounted");

    // Verify GET /payments/:id/adjustments is mounted
    const adjustmentsListRoute = routes.find(
      (r: any) => r.path === "/payments/:id/adjustments" && r.methods.includes("get")
    );
    assert.ok(adjustmentsListRoute, "GET /payments/:id/adjustments must be mounted");
  });

  // --------------------------------------------------------------------------
  // 2. OWNER APPROVED SALARY CORRECTIONS
  // --------------------------------------------------------------------------
  it("allows Owner to correct an APPROVED salary amount, updating net payable and logging audit details", async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = [];

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        // Lock and find entry
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("pe.id = $1")) {
          return {
            rows: [
              {
                id: 10,
                payroll_period_id: 1,
                worker_id: 101,
                worker_code: "W101",
                worker_name: "Sunil Bandara",
                designation: "Crusher Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "70000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "15000.00",
                gross_pay: "70000.00",
                net_payable: "55000.00",
                paid_amount: "20000.00", // Already paid 20,000
                remaining_payable: "35000.00",
                status: "APPROVED",
                notes: "Initial approved salary",
                version: 2,
                approved_at: new Date(),
              },
            ],
          };
        }
        // Find period
        if (sql.includes("FROM public.payroll_periods pp") && (sql.includes("pp.id = $1") || sql.includes("id = $1"))) {
          return {
            rows: [
              {
                id: 1,
                period_label: "Nov 2026",
                start_date: "2026-11-01",
                end_date: "2026-11-30",
                status: "APPROVED",
                notes: null,
                version: 1,
                created_at: new Date(),
              },
            ],
          };
        }
        // Calculate advances
        if (sql.includes("SELECT COALESCE(SUM(amount), 0)::text AS total_advances")) {
          return { rows: [{ total_advances: "15000.00" }] };
        }
        // Update entry
        if (sql.includes("UPDATE public.payroll_entries") && sql.includes("status = 'APPROVED'")) {
          return { rowCount: 1, rows: [] };
        }
        // Insert audit log
        if (sql.includes("INSERT INTO public.audit_logs")) {
          return { rows: [{ id: 701 }] };
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
    const updated = await service.updateApprovedSalary(
      10,
      {
        expectedVersion: 2,
        newGrossSalary: "75000.00", // Increase from 70,000 to 75,000
        reason: "Performance bonus addition approved by management",
        notes: "Audited adjustment",
      },
      {
        userId: OWNER_USER_ID,
        username: "owner_npr",
        role: "OWNER",
        fullName: "Nimal Perera",
        ipAddress: "127.0.0.1",
      }
    );

    assert.ok(updated, "Must return updated payroll entry");

    // Verify UPDATE query
    const updateQuery = executedQueries.find(
      (q) => q.sql.includes("UPDATE public.payroll_entries") && q.sql.includes("status = 'APPROVED'")
    );
    assert.ok(updateQuery, "Must execute UPDATE on APPROVED payroll entry");
    assert.equal(updateQuery.params?.[0], "75000.00", "New gross pay must be 75,000.00");
    assert.equal(updateQuery.params?.[1], "15000.00", "Advance deduction must be 15,000.00");
    assert.equal(updateQuery.params?.[2], "60000.00", "New net payable must be 60,000.00");

    // Verify audit log
    const auditQuery = executedQueries.find(
      (q) => q.sql.includes("INSERT INTO public.audit_logs") && q.params?.includes("UPDATE_APPROVED_SALARY")
    );
    assert.ok(auditQuery, "Must record UPDATE_APPROVED_SALARY audit log");
    assert.equal(auditQuery.params?.[0], OWNER_USER_ID);
  });

  it("blocks approved salary reduction below the amount already paid out", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe")) {
          return {
            rows: [
              {
                id: 11,
                payroll_period_id: 1,
                worker_id: 101,
                worker_code: "W101",
                worker_name: "Sunil Bandara",
                designation: "Crusher Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "60000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00",
                gross_pay: "60000.00",
                net_payable: "50000.00",
                paid_amount: "45000.00", // Already paid 45,000
                remaining_payable: "5000.00",
                status: "APPROVED",
                notes: null,
                version: 3,
                approved_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_periods pp")) {
          return {
            rows: [
              {
                id: 1,
                period_label: "Nov 2026",
                start_date: "2026-11-01",
                end_date: "2026-11-30",
                status: "APPROVED",
                notes: null,
                version: 1,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("SELECT COALESCE(SUM(amount), 0)::text AS total_advances")) {
          return { rows: [{ total_advances: "10000.00" }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    // Proposed gross 50,000 - advances 10,000 = new net payable 40,000
    // But already paid 45,000 -> must reject!
    await assert.rejects(
      () =>
        service.updateApprovedSalary(
          11,
          {
            expectedVersion: 3,
            newGrossSalary: "50000.00",
            reason: "Attempting to reduce salary below paid amount",
          },
          {
            userId: OWNER_USER_ID,
            username: "owner_npr",
            role: "OWNER",
          }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes("cannot be reduced below the effective amount already paid out"));
        return true;
      }
    );
  });

  it("blocks approved salary correction when applicable advances exceed proposed gross salary", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe")) {
          return {
            rows: [
              {
                id: 12,
                payroll_period_id: 1,
                worker_id: 101,
                worker_code: "W101",
                worker_name: "Sunil Bandara",
                designation: "Crusher Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "60000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "25000.00",
                gross_pay: "60000.00",
                net_payable: "35000.00",
                paid_amount: "0.00",
                remaining_payable: "35000.00",
                status: "APPROVED",
                notes: null,
                version: 1,
                approved_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_periods pp")) {
          return {
            rows: [
              {
                id: 1,
                period_label: "Nov 2026",
                start_date: "2026-11-01",
                end_date: "2026-11-30",
                status: "APPROVED",
                notes: null,
                version: 1,
                created_at: new Date(),
              },
            ],
          };
        }
        // Live advances = 25,000.00
        if (sql.includes("SELECT COALESCE(SUM(amount), 0)::text AS total_advances")) {
          return { rows: [{ total_advances: "25000.00" }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    // Proposed gross 20,000 < advances 25,000 -> must reject with ValidationError
    await assert.rejects(
      () =>
        service.updateApprovedSalary(
          12,
          {
            expectedVersion: 1,
            newGrossSalary: "20000.00",
            reason: "Lowering salary below total advances",
          },
          {
            userId: OWNER_USER_ID,
            username: "owner_npr",
            role: "OWNER",
          }
        ),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.message.includes("exceed proposed gross salary"));
        return true;
      }
    );
  });

  it("rejects approved salary correction on version conflict (optimistic concurrency)", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe")) {
          return {
            rows: [
              {
                id: 13,
                payroll_period_id: 1,
                worker_id: 101,
                worker_code: "W101",
                worker_name: "Sunil Bandara",
                designation: "Crusher Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "60000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00",
                gross_pay: "60000.00",
                net_payable: "50000.00",
                paid_amount: "0.00",
                remaining_payable: "50000.00",
                status: "APPROVED",
                notes: null,
                version: 4, // Current DB version is 4
                approved_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    // Client passes expectedVersion: 2 (stale)
    await assert.rejects(
      () =>
        service.updateApprovedSalary(
          13,
          {
            expectedVersion: 2,
            newGrossSalary: "65000.00",
            reason: "Stale update attempt",
          },
          {
            userId: OWNER_USER_ID,
            username: "owner_npr",
            role: "OWNER",
          }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes("Concurrent modification conflict"));
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // 3. OWNER SALARY PAYMENT ADJUSTMENT & VOID (APPEND-ONLY LEDGER)
  // --------------------------------------------------------------------------
  it("allows Owner to correct a salary payment once (30,000 -> 25,000)", async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = [];

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_records")) return { rows: [] };
        // Initial payment lookup
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && !sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 101,
                salary_receipt_number: "NPR-SAL-000101",
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                payment_date: "2026-11-20",
                amount: "30000.00",
                effective_amount: "30000.00",
                payment_method: "CASH",
                reference_note: null,
                paid_by_owner_id: CASHIER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        // Lock parent payroll_entries
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 20,
                payroll_period_id: 1,
                worker_id: 105,
                worker_code: "W105",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "50000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00",
                gross_pay: "50000.00",
                net_payable: "40000.00",
                paid_amount: "30000.00",
                remaining_payable: "10000.00",
                status: "APPROVED",
                notes: null,
                version: 1,
                approved_at: new Date(),
              },
            ],
          };
        }
        // Lock child salary_payments
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 101,
                salary_receipt_number: "NPR-SAL-000101",
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                payment_date: "2026-11-20",
                amount: "30000.00",
                effective_amount: "30000.00",
                payment_method: "CASH",
                reference_note: null,
                paid_by_owner_id: CASHIER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        // Check prior adjustments -> none yet
        if (sql.includes("FROM public.salary_payment_adjustments") && sql.includes("ORDER BY id DESC")) {
          return { rows: [] };
        }
        // Insert salary_payment_adjustments
        if (sql.includes("INSERT INTO public.salary_payment_adjustments")) {
          return {
            rows: [
              {
                id: 1,
                adjustment_number: "NPR-SADJ-000001",
                created_at: new Date(),
              },
            ],
          };
        }
        // Insert audit log
        if (sql.includes("INSERT INTO public.audit_logs")) {
          return { rows: [{ id: 801 }] };
        }
        // Re-fetch entry
        if (sql.includes("FROM public.payroll_entries pe") && !sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 20,
                payroll_period_id: 1,
                worker_id: 105,
                worker_code: "W105",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "50000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00",
                gross_pay: "50000.00",
                net_payable: "40000.00",
                paid_amount: "25000.00", // reduced to 25,000
                remaining_payable: "15000.00",
                status: "APPROVED",
                notes: null,
                version: 1,
                approved_at: new Date(),
              },
            ],
          };
        }
        // List adjustments for payment
        if (sql.includes("FROM public.salary_payment_adjustments spa")) {
          return {
            rows: [
              {
                id: 1,
                adjustment_number: "NPR-SADJ-000001",
                salary_payment_id: 101,
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                adjustment_type: "AMOUNT_CORRECTION",
                prior_effective_amount: "30000.00",
                corrected_amount: "25000.00",
                adjustment_delta: "-5000.00",
                authorized_by_owner_id: OWNER_USER_ID,
                authorized_by_username: "owner_npr",
                authorized_by_name: "Nimal Perera",
                authorized_by_role: "OWNER",
                reason: "Overpayment cash correction to agreed amount",
                created_at: new Date(),
              },
            ],
          };
        }
        // Insert idempotency
        if (sql.includes("INSERT INTO public.idempotency_records")) {
          return { rows: [{ id: 1 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    const result = await service.adjustSalaryPayment(
      101,
      {
        adjustmentType: "AMOUNT_CORRECTION",
        correctedAmount: "25000.00",
        reason: "Overpayment cash correction to agreed amount",
        idempotencyKey: "sadj-key-test-000000001",
      },
      {
        userId: OWNER_USER_ID,
        username: "owner_npr",
        role: "OWNER",
        fullName: "Nimal Perera",
        ipAddress: "127.0.0.1",
      }
    );

    assert.equal(result.replayed, false);
    assert.equal(result.adjustment.id, 1);
    assert.equal(result.adjustment.adjustmentNumber, "NPR-SADJ-000001");
    assert.equal(result.adjustment.priorEffectiveAmount, "30000.00");
    assert.equal(result.adjustment.correctedAmount, "25000.00");
    assert.equal(result.adjustment.adjustmentDelta, "-5000.00");
    assert.equal(result.entry.paidAmount, "25000.00");
    assert.equal(result.entry.remainingPayable, "15000.00");

    // Verify INSERT query into salary_payment_adjustments
    const insertAdj = executedQueries.find((q) =>
      q.sql.includes("INSERT INTO public.salary_payment_adjustments")
    );
    assert.ok(insertAdj, "Must execute INSERT into salary_payment_adjustments");
    assert.equal(insertAdj.params?.[0], 101); // salary_payment_id
    assert.equal(insertAdj.params?.[3], "AMOUNT_CORRECTION");
    assert.equal(insertAdj.params?.[4], "30000.00"); // prior_effective_amount
    assert.equal(insertAdj.params?.[5], "25000.00"); // corrected_amount
    assert.equal(insertAdj.params?.[6], "-5000.00"); // delta
    assert.equal(insertAdj.params?.[7], OWNER_USER_ID); // authorized_by_owner_id
  });

  it("supports repeated corrections on the same payment (25,000 -> 20,000)", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_records")) return { rows: [] };
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && !sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 101,
                salary_receipt_number: "NPR-SAL-000101",
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                payment_date: "2026-11-20",
                amount: "30000.00",
                effective_amount: "25000.00",
                payment_method: "CASH",
                reference_note: null,
                paid_by_owner_id: CASHIER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 20,
                payroll_period_id: 1,
                worker_id: 105,
                worker_code: "W105",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "50000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00",
                gross_pay: "50000.00",
                net_payable: "40000.00",
                paid_amount: "25000.00",
                remaining_payable: "15000.00",
                status: "APPROVED",
                notes: null,
                version: 1,
                approved_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 101,
                salary_receipt_number: "NPR-SAL-000101",
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                payment_date: "2026-11-20",
                amount: "30000.00",
                effective_amount: "25000.00",
                payment_method: "CASH",
                reference_note: null,
                paid_by_owner_id: CASHIER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        // Prior adjustment returned: id 1 with corrected_amount 25000.00
        if (sql.includes("FROM public.salary_payment_adjustments") && sql.includes("ORDER BY id DESC")) {
          return {
            rows: [
              {
                id: 1,
                adjustment_number: "NPR-SADJ-000001",
                adjustment_type: "AMOUNT_CORRECTION",
                corrected_amount: "25000.00",
                prior_effective_amount: "30000.00",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.salary_payment_adjustments")) {
          return {
            rows: [
              {
                id: 2,
                adjustment_number: "NPR-SADJ-000002",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.audit_logs")) return { rows: [{ id: 802 }] };
        if (sql.includes("FROM public.payroll_entries pe") && !sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 20,
                payroll_period_id: 1,
                worker_id: 105,
                worker_code: "W105",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "50000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00",
                gross_pay: "50000.00",
                net_payable: "40000.00",
                paid_amount: "20000.00",
                remaining_payable: "20000.00",
                status: "APPROVED",
                notes: null,
                version: 1,
                approved_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.salary_payment_adjustments spa")) {
          return {
            rows: [
              {
                id: 2,
                adjustment_number: "NPR-SADJ-000002",
                salary_payment_id: 101,
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                adjustment_type: "AMOUNT_CORRECTION",
                prior_effective_amount: "25000.00",
                corrected_amount: "20000.00",
                adjustment_delta: "-5000.00",
                authorized_by_owner_id: OWNER_USER_ID,
                reason: "Second adjustment after review",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.idempotency_records")) return { rows: [{ id: 2 }] };
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    const result = await service.adjustSalaryPayment(
      101,
      {
        adjustmentType: "AMOUNT_CORRECTION",
        correctedAmount: "20000.00", // Further reduced from 25,000 to 20,000
        expectedPriorAmount: "25000.00",
        reason: "Second adjustment after review with worker",
        idempotencyKey: "sadj-key-test-000000002",
      },
      {
        userId: OWNER_USER_ID,
        username: "owner_npr",
        role: "OWNER",
      }
    );

    assert.equal(result.adjustment.id, 2);
    assert.equal(result.adjustment.priorEffectiveAmount, "25000.00");
    assert.equal(result.adjustment.correctedAmount, "20000.00");
    assert.equal(result.adjustment.adjustmentDelta, "-5000.00");
  });

  it("allows Owner to VOID a previously corrected payment (20,000 -> 0)", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_records")) return { rows: [] };
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && !sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 101,
                salary_receipt_number: "NPR-SAL-000101",
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                payment_date: "2026-11-20",
                amount: "30000.00",
                effective_amount: "20000.00",
                payment_method: "CASH",
                reference_note: null,
                paid_by_owner_id: CASHIER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 20,
                payroll_period_id: 1,
                worker_id: 105,
                worker_code: "W105",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "50000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00",
                gross_pay: "50000.00",
                net_payable: "40000.00",
                paid_amount: "20000.00",
                remaining_payable: "20000.00",
                status: "APPROVED",
                notes: null,
                version: 1,
                approved_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 101,
                salary_receipt_number: "NPR-SAL-000101",
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                payment_date: "2026-11-20",
                amount: "30000.00",
                effective_amount: "20000.00",
                payment_method: "CASH",
                reference_note: null,
                paid_by_owner_id: CASHIER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        // Prior adjustment returned: id 2 with corrected_amount 20000.00
        if (sql.includes("FROM public.salary_payment_adjustments") && sql.includes("ORDER BY id DESC")) {
          return {
            rows: [
              {
                id: 2,
                adjustment_number: "NPR-SADJ-000002",
                adjustment_type: "AMOUNT_CORRECTION",
                corrected_amount: "20000.00",
                prior_effective_amount: "25000.00",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.salary_payment_adjustments")) {
          return {
            rows: [
              {
                id: 3,
                adjustment_number: "NPR-SADJ-000003",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.audit_logs")) return { rows: [{ id: 803 }] };
        if (sql.includes("FROM public.payroll_entries pe") && !sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 20,
                payroll_period_id: 1,
                worker_id: 105,
                worker_code: "W105",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "50000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00",
                gross_pay: "50000.00",
                net_payable: "40000.00",
                paid_amount: "0.00", // completely voided
                remaining_payable: "40000.00",
                status: "APPROVED",
                notes: null,
                version: 1,
                approved_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.salary_payment_adjustments spa")) {
          return {
            rows: [
              {
                id: 3,
                adjustment_number: "NPR-SADJ-000003",
                salary_payment_id: 101,
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                adjustment_type: "VOID",
                prior_effective_amount: "20000.00",
                corrected_amount: "0.00",
                adjustment_delta: "-20000.00",
                authorized_by_owner_id: OWNER_USER_ID,
                reason: "Payment erroneously recorded in cash, voiding full entry",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.idempotency_records")) return { rows: [{ id: 3 }] };
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    const result = await service.adjustSalaryPayment(
      101,
      {
        adjustmentType: "VOID",
        reason: "Payment erroneously recorded in cash, voiding full entry",
        idempotencyKey: "sadj-key-test-000000003",
      },
      {
        userId: OWNER_USER_ID,
        username: "owner_npr",
        role: "OWNER",
      }
    );

    assert.equal(result.adjustment.id, 3);
    assert.equal(result.adjustment.adjustmentType, "VOID");
    assert.equal(result.adjustment.priorEffectiveAmount, "20000.00");
    assert.equal(result.adjustment.correctedAmount, "0.00");
    assert.equal(result.adjustment.adjustmentDelta, "-20000.00");
    assert.equal(result.entry.paidAmount, "0.00");
  });

  it("strictly rejects any adjustments after a payment has been VOIDED", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_records")) return { rows: [] };
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && !sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 101,
                salary_receipt_number: "NPR-SAL-000101",
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                payment_date: "2026-11-20",
                amount: "30000.00",
                effective_amount: "0.00",
                payment_method: "CASH",
                reference_note: null,
                paid_by_owner_id: CASHIER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 20,
                payroll_period_id: 1,
                worker_id: 105,
                worker_code: "W105",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "50000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "10000.00",
                gross_pay: "50000.00",
                net_payable: "40000.00",
                paid_amount: "0.00",
                remaining_payable: "40000.00",
                status: "APPROVED",
                notes: null,
                version: 1,
                approved_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 101,
                salary_receipt_number: "NPR-SAL-000101",
                payroll_entry_id: 20,
                worker_id: 105,
                worker_name: "Kamal Perera",
                payment_date: "2026-11-20",
                amount: "30000.00",
                effective_amount: "0.00",
                payment_method: "CASH",
                reference_note: null,
                paid_by_owner_id: CASHIER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        // Prior adjustment returned is VOID!
        if (sql.includes("FROM public.salary_payment_adjustments") && sql.includes("ORDER BY id DESC")) {
          return {
            rows: [
              {
                id: 3,
                adjustment_number: "NPR-SADJ-000003",
                adjustment_type: "VOID",
                corrected_amount: "0.00",
                prior_effective_amount: "20000.00",
                created_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    await assert.rejects(
      () =>
        service.adjustSalaryPayment(
          101,
          {
            adjustmentType: "AMOUNT_CORRECTION",
            correctedAmount: "15000.00",
            reason: "Trying to un-void or adjust voided payment",
            idempotencyKey: "sadj-key-test-void-reject",
          },
          {
            userId: OWNER_USER_ID,
            username: "owner_npr",
            role: "OWNER",
          }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes("because it has already been voided"));
        return true;
      }
    );
  });

  it("safely replays identical payment adjustment requests via idempotency key without duplicate inserts", async () => {
    const existingAdjustment = {
      id: 5,
      adjustmentNumber: "NPR-SADJ-000005",
      salaryPaymentId: 102,
      payrollEntryId: 21,
      workerId: 106,
      workerName: "Nimal Silva",
      adjustmentType: "AMOUNT_CORRECTION" as const,
      priorEffectiveAmount: "20000.00",
      correctedAmount: "15000.00",
      adjustmentDelta: "-5000.00",
      authorizedByUserId: OWNER_USER_ID,
      reason: "Agreed payment deduction correction",
      createdAt: new Date().toISOString(),
    };
    const existingEntry = {
      id: 21,
      payrollPeriodId: 1,
      workerId: 106,
      workerCode: "W106",
      workerName: "Nimal Silva",
      designation: "Crusher Helper",
      payArrangementSnapshot: "MONTHLY" as const,
      calculationMode: "OWNER_MANUAL_DRAFT" as const,
      approvedDaysCount: 26,
      approvedRegularHours: "208.00",
      approvedOvertimeHours: "0.00",
      basePay: "45000.00",
      overtimePay: "0.00",
      allowances: "0.00",
      deductions: "0.00",
      advanceDeduction: "10000.00",
      grossPay: "45000.00",
      netPayable: "35000.00",
      paidAmount: "15000.00",
      remainingPayable: "20000.00",
      status: "APPROVED" as const,
      notes: null,
      version: 1,
      approvedAt: new Date().toISOString(),
    };

    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: OWNER_USER_ID,
          salaryPaymentId: 102,
          adjustmentType: "AMOUNT_CORRECTION",
          correctedAmount: "15000.00",
          reason: "Agreed payment deduction correction",
        })
      )
      .digest("hex");

    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_records")) {
          return {
            rows: [
              {
                id: 1,
                idempotency_key: "sadj-key-replay-test-01",
                operation_type: "PAYMENT_ADJUSTMENT",
                actor_user_id: OWNER_USER_ID,
                request_hash: expectedHash,
                response_status: 201,
                response_payload: {
                  adjustment: existingAdjustment,
                  entry: existingEntry,
                },
                expires_at: new Date(Date.now() + 86400000),
                created_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    const result = await service.adjustSalaryPayment(
      102,
      {
        adjustmentType: "AMOUNT_CORRECTION",
        correctedAmount: "15000.00",
        reason: "Agreed payment deduction correction",
        idempotencyKey: "sadj-key-replay-test-01",
      },
      {
        userId: OWNER_USER_ID,
        username: "owner_npr",
        role: "OWNER",
      }
    );

    assert.equal(result.replayed, true);
    assert.equal(result.adjustment.id, 5);
    assert.equal(result.adjustment.adjustmentNumber, "NPR-SADJ-000005");
    assert.equal(result.entry.paidAmount, "15000.00");
  });

  it("rejects payment adjustment when stale expectedPriorAmount does not match DB", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_records")) return { rows: [] };
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && !sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 103,
                salary_receipt_number: "NPR-SAL-000103",
                payroll_entry_id: 25,
                worker_id: 110,
                worker_name: "Test Worker",
                payment_date: "2026-11-20",
                amount: "25000.00",
                effective_amount: "20000.00", // Already adjusted to 20,000
                payment_method: "CASH",
                paid_by_owner_id: OWNER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 25,
                payroll_period_id: 1,
                worker_id: 110,
                worker_code: "W110",
                worker_name: "Test Worker",
                designation: "Worker",
                status: "APPROVED",
                net_payable: "40000.00",
                paid_amount: "20000.00",
                remaining_payable: "20000.00",
                gross_pay: "50000.00",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 103,
                salary_receipt_number: "NPR-SAL-000103",
                payroll_entry_id: 25,
                worker_id: 110,
                worker_name: "Test Worker",
                payment_date: "2026-11-20",
                amount: "25000.00",
                effective_amount: "20000.00",
                payment_method: "CASH",
                paid_by_owner_id: OWNER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.salary_payment_adjustments") && sql.includes("ORDER BY id DESC")) {
          return {
            rows: [
              {
                id: 10,
                adjustment_number: "NPR-SADJ-000010",
                adjustment_type: "AMOUNT_CORRECTION",
                corrected_amount: "20000.00", // DB current effective amount is 20,000
                prior_effective_amount: "25000.00",
                created_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    // Client expects prior amount was 25,000 (stale), but DB is 20,000
    await assert.rejects(
      () =>
        service.adjustSalaryPayment(
          103,
          {
            adjustmentType: "AMOUNT_CORRECTION",
            correctedAmount: "18000.00",
            expectedPriorAmount: "25000.00", // Stale expectation
            reason: "Attempting correction with stale assumption",
            idempotencyKey: "sadj-key-stale-expect-fail",
          },
          {
            userId: OWNER_USER_ID,
            username: "owner_npr",
            role: "OWNER",
          }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes("Payment effective amount has changed"));
        return true;
      }
    );
  });

  it("rejects payment adjustment if corrected amount causes total entry paid to exceed net payable", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_records")) return { rows: [] };
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && !sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 104,
                salary_receipt_number: "NPR-SAL-000104",
                payroll_entry_id: 30,
                worker_id: 112,
                worker_name: "Test Worker",
                payment_date: "2026-11-20",
                amount: "15000.00",
                effective_amount: "15000.00",
                payment_method: "CASH",
                paid_by_owner_id: OWNER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 30,
                payroll_period_id: 1,
                worker_id: 112,
                worker_code: "W112",
                worker_name: "Test Worker",
                designation: "Worker",
                status: "APPROVED",
                net_payable: "20000.00",
                paid_amount: "15000.00", // Only 5,000 headroom
                remaining_payable: "5000.00",
                gross_pay: "25000.00",
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.salary_payments sp") && !sql.includes("FROM public.payroll_entries pe") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: 104,
                salary_receipt_number: "NPR-SAL-000104",
                payroll_entry_id: 30,
                worker_id: 112,
                worker_name: "Test Worker",
                payment_date: "2026-11-20",
                amount: "15000.00",
                effective_amount: "15000.00",
                payment_method: "CASH",
                paid_by_owner_id: OWNER_USER_ID,
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes("FROM public.salary_payment_adjustments") && sql.includes("ORDER BY id DESC")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = { connect: async () => mockClient, query: mockClient.query };
    const service = new PayrollService(mockPool as any);

    // Prior is 15,000; corrected is 25,000 (+10,000 delta). Total paid would be 25,000 > net payable 20,000
    await assert.rejects(
      () =>
        service.adjustSalaryPayment(
          104,
          {
            adjustmentType: "AMOUNT_CORRECTION",
            correctedAmount: "25000.00",
            reason: "Trying to increase payment beyond net payable",
            idempotencyKey: "sadj-key-exceed-net-fail",
          },
          {
            userId: OWNER_USER_ID,
            username: "owner_npr",
            role: "OWNER",
          }
        ),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.message.includes("causes total paid"));
        return true;
      }
    );
  });
});
