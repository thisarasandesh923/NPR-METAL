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

  return router;
}
