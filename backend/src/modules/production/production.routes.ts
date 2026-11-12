import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { ProductionController } from "./production.controller.js";
import type { ProductionService } from "./production.service.js";

export function createProductionRouter(
  productionService: ProductionService,
  requireAuth: RequestHandler
): Router {
  const router = Router();
  const controller = new ProductionController(productionService);

  router.get("/", requireAuth, requireRole("OWNER", "CASHIER"), controller.list);
  router.post("/", requireAuth, requireRole("OWNER", "CASHIER"), controller.create);
  router.put("/:id", requireAuth, requireRole("OWNER", "CASHIER"), controller.update);
  router.post("/:id/submit", requireAuth, requireRole("OWNER", "CASHIER"), controller.submit);
  router.post("/:id/cancel", requireAuth, requireRole("OWNER", "CASHIER"), controller.cancel);
  router.post("/:id/review", requireAuth, requireRole("OWNER"), controller.review);

  return router;
}

