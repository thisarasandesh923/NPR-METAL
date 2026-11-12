import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { PayrollController } from "./payroll.controller.js";
import type { PayrollService } from "./payroll.service.js";

/**
 * STRICT OWNER-ONLY PAYROLL & EXPENSES ROUTERS
 * Every single endpoint rejects CASHIER roles with 403 Forbidden.
 */
export function createPayrollRouters(
  payrollService: PayrollService,
  requireAuth: RequestHandler
): { payrollRouter: Router; expensesRouter: Router } {
  const controller = new PayrollController(payrollService);
  const ownerGuard = requireRole("OWNER");

  const payrollRouter = Router();
  payrollRouter.get("/compensation", requireAuth, ownerGuard, controller.listCompensation);
  payrollRouter.put("/compensation", requireAuth, ownerGuard, controller.upsertCompensation);
  payrollRouter.get("/periods", requireAuth, ownerGuard, controller.listPeriods);
  payrollRouter.post("/periods", requireAuth, ownerGuard, controller.createPeriod);
  payrollRouter.post("/periods/:id/prepare", requireAuth, ownerGuard, controller.preparePeriod);
  payrollRouter.get("/periods/:id/entries", requireAuth, ownerGuard, controller.listPeriodEntries);
  payrollRouter.put("/entries/:id", requireAuth, ownerGuard, controller.updateDraftEntry);
  payrollRouter.post("/entries/:id/approve", requireAuth, ownerGuard, controller.approveEntry);
  payrollRouter.post("/entries/:id/payments", requireAuth, ownerGuard, controller.recordSalaryPayment);
  payrollRouter.get("/advances", requireAuth, ownerGuard, controller.listAdvances);
  payrollRouter.post("/advances", requireAuth, ownerGuard, controller.recordAdvance);
  payrollRouter.get("/payments", requireAuth, ownerGuard, controller.listSalaryPayments);

  const expensesRouter = Router();
  expensesRouter.get("/", requireAuth, ownerGuard, controller.listExpenses);
  expensesRouter.post("/", requireAuth, ownerGuard, controller.recordExpense);

  return { payrollRouter, expensesRouter };
}

