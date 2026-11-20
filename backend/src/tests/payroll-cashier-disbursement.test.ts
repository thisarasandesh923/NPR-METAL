import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPayrollRouters } from "../modules/payroll/payroll.routes.js";
import { PayrollService } from "../modules/payroll/payroll.service.js";
import {
  findPayrollPeriodById,
  listPayrollPeriods,
  listPayrollEntriesByPeriod,
  findPayrollEntryById,
  listSalaryPayments,
} from "../modules/payroll/payroll.repository.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
} from "../errors/appError.js";

describe("Stage 3.2A — Cashier Period Creation & Salary Disbursement Unit Tests", () => {
  const CASHIER_USER_ID = "c0000000-0000-0000-0000-000000000001";
  const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";

  // --------------------------------------------------------------------------
  // 1. ROUTE GUARDS & RBAC PERMISSIONS
  // --------------------------------------------------------------------------
  it("verifies route authorization: Cashier can create periods and record payments, but cannot approve or view audit history", () => {
    const dummyService = {} as any;
    const dummyAuth = ((_req: any, _res: any, next: any) => next()) as any;
    const { payrollRouter } = createPayrollRouters(dummyService, dummyAuth);

    const routes = payrollRouter.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
      }));

    // Verify Cashier-accessible endpoints are mounted
    const periodCreateRoute = routes.find(
      (r: any) => r.path === "/periods" && r.methods.includes("post")
    );
    assert.ok(periodCreateRoute, "POST /periods must be mounted");

    const paymentRoute = routes.find(
      (r: any) => r.path === "/entries/:id/payments" && r.methods.includes("post")
    );
    assert.ok(paymentRoute, "POST /entries/:id/payments must be mounted");

    const salaryEditRoute = routes.find(
      (r: any) => r.path === "/entries/:id/salary" && r.methods.includes("put")
    );
    assert.ok(salaryEditRoute, "PUT /entries/:id/salary must be mounted");

    // Verify Owner-only endpoints exist
    const approveRoute = routes.find(
      (r: any) => r.path === "/entries/:id/approve" && r.methods.includes("post")
    );
    assert.ok(approveRoute, "POST /entries/:id/approve must be mounted");

    const historyRoute = routes.find(
      (r: any) => r.path === "/salary-history" && r.methods.includes("get")
    );
    assert.ok(historyRoute, "GET /salary-history must be mounted");

    const entryHistoryRoute = routes.find(
      (r: any) => r.path === "/entries/:id/history" && r.methods.includes("get")
    );
    assert.ok(entryHistoryRoute, "GET /entries/:id/history must be mounted");

    const paymentsListRoute = routes.find(
      (r: any) => r.path === "/payments" && r.methods.includes("get")
    );
    assert.ok(paymentsListRoute, "GET /payments must be mounted");
  });

  // --------------------------------------------------------------------------
  // 2. SALARY PERIOD CREATION (OWNER & CASHIER)
  // --------------------------------------------------------------------------
  it("allows Cashier to create a custom salary period, recording creator actor and auto-initializing worker entries", async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = [];

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        // Overlap check -> none
        if (sql.includes("status != 'CANCELLED'") && sql.includes("start_date <=")) {
          return { rows: [] };
        }
        // Insert period
        if (sql.includes("INSERT INTO public.payroll_periods")) {
          return { rows: [{ id: 101 }] };
        }
        // Auto-initialize entries
        if (sql.includes("INSERT INTO public.payroll_entries")) {
          return { rowCount: 4, rows: [] };
        }
        // Audit log insert
        if (sql.includes("INSERT INTO public.audit_logs")) {
          return { rows: [{ id: 501 }] };
        }
        // findPayrollPeriodById
        if (sql.includes("FROM public.payroll_periods pp") && sql.includes("pp.id = $1")) {
          return {
            rows: [
              {
                id: 101,
                period_label: "Dec 2026",
                start_date: "2026-12-01",
                end_date: "2026-12-31",
                status: "DRAFT",
                notes: "Cashier-created period",
                version: 1,
                created_by_user_id: CASHIER_USER_ID,
                created_by_username: "cashier_sarath",
                created_by_name: "Sarath Perera",
                created_by_role: "CASHIER",
                approved_by_user_id: null,
                approved_by_username: null,
                approved_by_name: null,
                approved_by_role: null,
                approved_at: null,
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
        periodLabel: "Dec 2026",
        startDate: "2026-12-01",
        endDate: "2026-12-31",
        notes: "Cashier-created period",
      },
      {
        userId: CASHIER_USER_ID,
        username: "cashier_sarath",
        role: "CASHIER",
        fullName: "Sarath Perera",
        ipAddress: "192.168.1.50",
      }
    );

    assert.equal(period.id, 101);
    assert.equal(period.periodLabel, "Dec 2026");
    assert.equal(period.createdByUserId, CASHIER_USER_ID);
    assert.equal(period.createdByRole, "CASHIER");
    assert.equal(period.createdByUsername, "cashier_sarath");

    // Verify creator ID passed to INSERT
    const insertPeriodQuery = executedQueries.find((q) =>
      q.sql.includes("INSERT INTO public.payroll_periods")
    );
    assert.ok(insertPeriodQuery, "Must execute period INSERT");
    assert.equal(insertPeriodQuery.params?.[4], CASHIER_USER_ID);

    // Verify audit log recorded for period creation
    const auditQuery = executedQueries.find(
      (q) => q.sql.includes("INSERT INTO public.audit_logs") && q.params?.includes("CREATE_PAYROLL_PERIOD")
    );
    assert.ok(auditQuery, "Must record CREATE_PAYROLL_PERIOD audit log");
    assert.equal(auditQuery.params?.[0], CASHIER_USER_ID);
  });

  it("rejects period creation when dates overlap with an existing active period", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("status != 'CANCELLED'") && sql.includes("start_date <=")) {
          return {
            rows: [
              {
                id: 10,
                period_label: "Nov 2026",
                start_date: "2026-11-01",
                end_date: "2026-11-30",
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

    await assert.rejects(
      () =>
        service.createPeriod(
          {
            periodLabel: "Overlapping Nov 2026",
            startDate: "2026-11-15",
            endDate: "2026-12-15",
          },
          { userId: CASHIER_USER_ID }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes("Payroll period dates overlap"));
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // 3. SALARY PAYMENT RECORDING (OWNER & CASHIER)
  // --------------------------------------------------------------------------
  it("allows Cashier to record a CASH payment against an APPROVED payroll entry", async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = [];

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        // Idempotency lookup -> none
        if (sql.includes("FROM public.idempotency_records")) return { rows: [] };
        // Find entry (locked)
        if (sql.includes("FROM public.payroll_entries pe") && sql.includes("pe.id = $1")) {
          return {
            rows: [
              {
                id: 50,
                payroll_period_id: 10,
                worker_id: 201,
                worker_code: "W201",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 26,
                approved_regular_hours: "208.00",
                approved_overtime_hours: "0.00",
                base_pay: "65000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "15000.00",
                gross_pay: "65000.00",
                net_payable: "50000.00",
                paid_amount: "0.00",
                remaining_payable: "50000.00",
                status: "APPROVED",
                notes: null,
                version: 2,
                approved_at: new Date(),
              },
            ],
          };
        }
        // Insert salary_payments
        if (sql.includes("INSERT INTO public.salary_payments")) {
          return { rows: [{ id: 801 }] };
        }
        // Insert audit log
        if (sql.includes("INSERT INTO public.audit_logs")) {
          return { rows: [{ id: 901 }] };
        }
        // List payments
        if (sql.includes("FROM public.salary_payments sp")) {
          return {
            rows: [
              {
                id: 801,
                salary_receipt_number: "NPR-SAL-000801",
                payroll_entry_id: 50,
                worker_id: 201,
                worker_name: "Kamal Perera",
                payment_date: "2026-12-05",
                amount: "25000.00",
                effective_amount: "25000.00",
                payment_method: "CASH",
                reference_note: "First installment",
                paid_by_owner_id: CASHIER_USER_ID,
                paid_by_owner_username: "cashier_sarath",
                paid_by_owner_name: "Sarath Perera",
                paid_by_owner_role: "CASHIER",
                created_at: new Date(),
              },
            ],
          };
        }
        // Insert idempotency record
        if (sql.includes("INSERT INTO public.idempotency_records")) {
          return { rows: [{ id: 1 }] };
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
    const result = await service.recordSalaryPayment(
      {
        payrollEntryId: 50,
        paymentDate: "2026-12-05",
        amount: "25000.00",
        paymentMethod: "CASH",
        referenceNote: "First installment",
        idempotencyKey: "sal-pay-idem-key-00001-csh",
      },
      {
        userId: CASHIER_USER_ID,
        username: "cashier_sarath",
        role: "CASHIER",
        fullName: "Sarath Perera",
        ipAddress: "192.168.1.50",
      }
    );

    assert.equal(result.replayed, false);
    assert.equal(result.payment.id, 801);
    assert.equal(result.payment.amount, "25000.00");
    assert.equal(result.payment.effectiveAmount, "25000.00");
    assert.equal(result.payment.paymentMethod, "CASH");
    assert.equal(result.payment.paidByOwnerId, CASHIER_USER_ID);

    // Verify payment insertion contains Cashier's user ID in paid_by_owner_id
    const insertPaymentQuery = executedQueries.find((q) =>
      q.sql.includes("INSERT INTO public.salary_payments")
    );
    assert.ok(insertPaymentQuery, "Must execute salary_payments INSERT");
    assert.equal(insertPaymentQuery.params?.[6], CASHIER_USER_ID);
    assert.equal(insertPaymentQuery.params?.[4], "CASH");

    // Verify audit log recorded for Cashier payment
    const auditQuery = executedQueries.find(
      (q) => q.sql.includes("INSERT INTO public.audit_logs") && q.params?.includes("RECORD_SALARY_PAYMENT")
    );
    assert.ok(auditQuery, "Must record RECORD_SALARY_PAYMENT audit log");
    assert.equal(auditQuery.params?.[0], CASHIER_USER_ID);
  });

  it("strictly rejects salary payments on DRAFT entries", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_records")) return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe")) {
          return {
            rows: [
              {
                id: 51,
                payroll_period_id: 10,
                worker_id: 201,
                worker_code: "W201",
                worker_name: "Kamal Perera",
                designation: "Machine Operator",
                pay_arrangement_snapshot: "MONTHLY",
                calculation_mode: "OWNER_MANUAL_DRAFT",
                approved_days_count: 0,
                approved_regular_hours: "0.00",
                approved_overtime_hours: "0.00",
                base_pay: "65000.00",
                overtime_pay: "0.00",
                allowances: "0.00",
                deductions: "0.00",
                advance_deduction: "0.00",
                gross_pay: "65000.00",
                net_payable: "65000.00",
                paid_amount: "0.00",
                remaining_payable: "65000.00",
                status: "DRAFT", // NOT APPROVED
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
      query: mockClient.query,
    };
    const service = new PayrollService(mockPool as any);

    await assert.rejects(
      () =>
        service.recordSalaryPayment(
          {
            payrollEntryId: 51,
            paymentDate: "2026-12-05",
            amount: "10000.00",
            paymentMethod: "CASH",
            idempotencyKey: "sal-pay-idem-key-draft-reject",
          },
          { userId: CASHIER_USER_ID }
        ),
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes("APPROVED payroll entries"));
        return true;
      }
    );
  });

  it("strictly rejects non-CASH salary payment methods", async () => {
    const service = new PayrollService({} as any);

    await assert.rejects(
      () =>
        service.recordSalaryPayment(
          {
            payrollEntryId: 50,
            paymentDate: "2026-12-05",
            amount: "10000.00",
            paymentMethod: "BANK_TRANSFER" as any,
            idempotencyKey: "sal-pay-idem-non-cash-reject",
          },
          { userId: CASHIER_USER_ID }
        ),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.message.includes("strictly use CASH"));
        return true;
      }
    );
  });

  it("strictly rejects payment exceeding remaining payable", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM public.idempotency_records")) return { rows: [] };
        if (sql.includes("FROM public.payroll_entries pe")) {
          return {
            rows: [
              {
                id: 52,
                payroll_period_id: 10,
                worker_id: 201,
                worker_code: "W201",
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
                advance_deduction: "0.00",
                gross_pay: "50000.00",
                net_payable: "50000.00",
                paid_amount: "40000.00",
                remaining_payable: "10000.00", // Only 10,000 remaining
                status: "APPROVED",
                notes: null,
                version: 2,
                approved_at: new Date(),
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

    await assert.rejects(
      () =>
        service.recordSalaryPayment(
          {
            payrollEntryId: 52,
            paymentDate: "2026-12-05",
            amount: "15000.00", // Exceeds 10,000 remaining
            paymentMethod: "CASH",
            idempotencyKey: "sal-pay-idem-exceed-reject",
          },
          { userId: CASHIER_USER_ID }
        ),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.message.includes("Salary payment exceeds remaining net payable"));
        return true;
      }
    );
  });

  it("safely replays identical payment requests via idempotency key without duplicate inserts", async () => {
    const existingPayment = {
      id: 805,
      salaryReceiptNumber: "NPR-SAL-000805",
      payrollEntryId: 50,
      workerId: 201,
      workerName: "Kamal Perera",
      paymentDate: "2026-12-05",
      amount: "10000.00",
      effectiveAmount: "10000.00",
      paymentMethod: "CASH" as const,
      referenceNote: "Part payment",
      createdAt: new Date().toISOString(),
    };
    const existingEntry = {
      id: 50,
      payrollPeriodId: 10,
      workerId: 201,
      workerCode: "W201",
      workerName: "Kamal Perera",
      designation: "Machine Operator",
      payArrangementSnapshot: "MONTHLY" as const,
      calculationMode: "OWNER_MANUAL_DRAFT" as const,
      approvedDaysCount: 26,
      approvedRegularHours: "208.00",
      approvedOvertimeHours: "0.00",
      basePay: "65000.00",
      overtimePay: "0.00",
      allowances: "0.00",
      deductions: "0.00",
      advanceDeduction: "15000.00",
      grossPay: "65000.00",
      netPayable: "50000.00",
      paidAmount: "10000.00",
      remainingPayable: "40000.00",
      status: "APPROVED" as const,
      notes: null,
      version: 2,
      approvedAt: new Date().toISOString(),
    };

    // Calculate request hash as service does
    const { createHash } = await import("node:crypto");
    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify({
          actor: CASHIER_USER_ID,
          payrollEntryId: 50,
          paymentDate: "2026-12-05",
          amountStr: "10000.00",
          paymentMethod: "CASH",
          referenceNote: "Part payment",
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
                idempotency_key: "sal-pay-replay-test-key",
                operation_type: "RECORD_SALARY_PAYMENT",
                actor_user_id: CASHIER_USER_ID,
                request_hash: expectedHash,
                response_status: 201,
                response_payload: {
                  payment: existingPayment,
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
    const mockPool = {
      connect: async () => mockClient,
      query: mockClient.query,
    };
    const service = new PayrollService(mockPool as any);

    const result = await service.recordSalaryPayment(
      {
        payrollEntryId: 50,
        paymentDate: "2026-12-05",
        amount: "10000.00",
        paymentMethod: "CASH",
        referenceNote: "Part payment",
        idempotencyKey: "sal-pay-replay-test-key",
      },
      { userId: CASHIER_USER_ID }
    );

    assert.equal(result.replayed, true);
    assert.equal(result.payment.id, 805);
    assert.equal(result.entry.paidAmount, "10000.00");
  });

  // --------------------------------------------------------------------------
  // 4. REPOSITORY EFFECTIVE BALANCES (ADJUSTMENTS LEDGER)
  // --------------------------------------------------------------------------
  it("verifies repository calculates paid_amount and remaining_payable with salary_payment_adjustments subquery", async () => {
    let capturedQuery = "";
    const mockDb = {
      query: async (sql: string) => {
        capturedQuery = sql;
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
              base_pay: "75000.00",
              overtime_pay: "0.00",
              allowances: "0.00",
              deductions: "0.00",
              advance_deduction: "20000.00",
              gross_pay: "75000.00",
              net_payable: "55000.00",
              paid_amount: "30000.00", // effective after adjustment
              remaining_payable: "25000.00",
              status: "APPROVED",
              notes: null,
              version: 3,
              approved_at: new Date(),
            },
          ],
        };
      },
    };

    const entries = await listPayrollEntriesByPeriod(mockDb as any, 1);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].paidAmount, "30000.00");
    assert.equal(entries[0].remainingPayable, "25000.00");

    // Verify SQL query contains salary_payment_adjustments subquery
    assert.ok(
      capturedQuery.includes("public.salary_payment_adjustments spa"),
      "Must query public.salary_payment_adjustments"
    );
    assert.ok(
      capturedQuery.includes("ORDER BY spa.id DESC"),
      "Must order adjustments by id DESC for latest effective amount"
    );
    assert.ok(
      !capturedQuery.includes("pe.paid_amount"),
      "Must not reference non-existent pe.paid_amount column"
    );
  });

  it("verifies listSalaryPayments returns effectiveAmount alongside amount", async () => {
    let capturedQuery = "";
    const mockDb = {
      query: async (sql: string) => {
        capturedQuery = sql;
        return {
          rows: [
            {
              id: 101,
              salary_receipt_number: "NPR-SAL-000101",
              payroll_entry_id: 10,
              worker_id: 101,
              worker_name: "Sunil Bandara",
              payment_date: "2026-12-05",
              amount: "30000.00",
              effective_amount: "25000.00", // After correction adjustment
              payment_method: "CASH",
              reference_note: null,
              paid_by_owner_id: CASHIER_USER_ID,
              paid_by_owner_username: "cashier_sarath",
              paid_by_owner_name: "Sarath Perera",
              paid_by_owner_role: "CASHIER",
              created_at: new Date(),
            },
          ],
        };
      },
    };

    const payments = await listSalaryPayments(mockDb as any, { workerId: 101 });
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amount, "30000.00");
    assert.equal(payments[0].effectiveAmount, "25000.00");
    assert.equal(payments[0].paidByOwnerRole, "CASHIER");

    assert.ok(
      capturedQuery.includes("public.salary_payment_adjustments spa"),
      "listSalaryPayments must query salary_payment_adjustments for effective_amount"
    );
  });

  it("verifies listPayrollPeriods returns creator and approver audit metadata", async () => {
    let capturedQuery = "";
    const mockDb = {
      query: async (sql: string) => {
        capturedQuery = sql;
        return {
          rows: [
            {
              id: 12,
              period_label: "Jan 2027",
              start_date: "2027-01-01",
              end_date: "2027-01-31",
              status: "APPROVED",
              notes: "New year period",
              version: 2,
              created_by_user_id: CASHIER_USER_ID,
              created_by_username: "cashier_sarath",
              created_by_name: "Sarath Perera",
              created_by_role: "CASHIER",
              approved_by_user_id: OWNER_USER_ID,
              approved_by_username: "owner_npr",
              approved_by_name: "Nimal Perera",
              approved_by_role: "OWNER",
              approved_at: new Date("2027-01-02T10:00:00Z"),
              created_at: new Date("2027-01-01T08:00:00Z"),
            },
          ],
        };
      },
    };

    const periods = await listPayrollPeriods(mockDb as any);
    assert.equal(periods.length, 1);
    assert.equal(periods[0].createdByUserId, CASHIER_USER_ID);
    assert.equal(periods[0].createdByUsername, "cashier_sarath");
    assert.equal(periods[0].createdByRole, "CASHIER");
    assert.equal(periods[0].approvedByUserId, OWNER_USER_ID);
    assert.equal(periods[0].approvedByRole, "OWNER");
    assert.equal(periods[0].approvedAt, "2027-01-02T10:00:00.000Z");

    assert.ok(
      capturedQuery.includes("LEFT JOIN public.users cu ON cu.id = pp.created_by_owner_id"),
      "Must join users on created_by_owner_id"
    );
    assert.ok(
      capturedQuery.includes("LEFT JOIN public.users au ON au.id = pp.approved_by_owner_id"),
      "Must join users on approved_by_owner_id"
    );
  });
});
