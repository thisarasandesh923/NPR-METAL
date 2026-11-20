import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { PayrollController } from "./payroll.controller.js";
import type { PayrollService } from "./payroll.service.js";

/**
 * RBAC PAYROLL & EXPENSES ROUTERS
 * Both OWNER and CASHIER can view payroll/expenses, create custom salary periods,
 * update draft manual salaries, and record cash salary payments against OWNER-approved entries.
 * Privileged actions (approving entries, correcting approved salaries, correcting or voiding
 * salary payments, preparing system drafts, and viewing complete salary audit history)
 * strictly require OWNER role.
 */
export function createPayrollRouters(
  payrollService: PayrollService,
  requireAuth: RequestHandler
): { payrollRouter: Router; expensesRouter: Router } {
  const controller = new PayrollController(payrollService);
  const ownerGuard = requireRole("OWNER");
  const staffGuard = requireRole("OWNER", "CASHIER");

  const payrollRouter = Router();
  payrollRouter.get("/compensation", requireAuth, staffGuard, controller.listCompensation);
  payrollRouter.put("/compensation", requireAuth, staffGuard, controller.upsertCompensation);
  payrollRouter.get("/compensation/history", requireAuth, ownerGuard, controller.listCompensationHistory);
  payrollRouter.get("/periods", requireAuth, staffGuard, controller.listPeriods);
  payrollRouter.post("/periods", requireAuth, staffGuard, controller.createPeriod);
  payrollRouter.post("/periods/:id/prepare", requireAuth, ownerGuard, controller.preparePeriod);
  payrollRouter.get("/periods/:id/entries", requireAuth, staffGuard, controller.listPeriodEntries);
  payrollRouter.post("/periods/:id/initialize", requireAuth, staffGuard, controller.initializeManualPeriod);
  payrollRouter.put("/entries/:id", requireAuth, ownerGuard, controller.updateDraftEntry);
  payrollRouter.put("/entries/:id/salary", requireAuth, staffGuard, controller.updateManualSalary);
  payrollRouter.put("/entries/:id/approved-salary", requireAuth, ownerGuard, controller.updateApprovedSalary);
  payrollRouter.get("/entries/:id/history", requireAuth, ownerGuard, controller.listSalaryAuditHistory);
  payrollRouter.get("/salary-history", requireAuth, ownerGuard, controller.listSalaryAuditHistory);
  payrollRouter.post("/entries/:id/approve", requireAuth, ownerGuard, controller.approveEntry);
  payrollRouter.post("/entries/:id/payments", requireAuth, staffGuard, controller.recordSalaryPayment);
  payrollRouter.post("/payments/:id/adjust", requireAuth, ownerGuard, controller.adjustSalaryPayment);
  payrollRouter.get("/payments/:id/adjustments", requireAuth, ownerGuard, controller.listPaymentAdjustments);
  payrollRouter.get("/advances", requireAuth, staffGuard, controller.listAdvances);
  payrollRouter.post("/advances", requireAuth, staffGuard, controller.recordAdvance);
  payrollRouter.get("/payments", requireAuth, ownerGuard, controller.listSalaryPayments);

  const expensesRouter = Router();
  expensesRouter.get("/", requireAuth, staffGuard, controller.listExpenses);
  expensesRouter.post("/", requireAuth, staffGuard, controller.recordExpense);

  return { payrollRouter, expensesRouter };
}

