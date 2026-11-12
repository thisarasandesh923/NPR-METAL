import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { ReportsController } from "./reports.controller.js";
import type { ReportsService } from "./reports.service.js";

export function createReportsRouter(
  reportsService: ReportsService,
  requireAuth: RequestHandler
): Router {
  const router = Router();
  const controller = new ReportsController(reportsService);

  router.get(
    "/overview",
    requireAuth,
    requireRole("OWNER"),
    controller.overview
  );

  router.get(
    "/financial",
    requireAuth,
    requireRole("OWNER"),
    controller.financial
  );

  router.get(
    "/operations",
    requireAuth,
    requireRole("OWNER"),
    controller.operations
  );

  router.get(
    "/export",
    requireAuth,
    requireRole("OWNER"),
    controller.exportGeneral
  );

  router.get(
    "/export/payroll",
    requireAuth,
    requireRole("OWNER"),
    controller.exportPayroll
  );

  return router;
}
