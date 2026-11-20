import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { MaterialsController } from "./materials.controller.js";
import type { MaterialsService } from "./materials.service.js";

export function createMaterialsRouter(
  materialsService: MaterialsService,
  requireAuth: RequestHandler
): Router {
  const router = Router();
  const controller = new MaterialsController(materialsService);

  router.get(
    "/",
    requireAuth,
    requireRole("OWNER", "CASHIER"),
    controller.listActive
  );
  router.get(
    "/price-history",
    requireAuth,
    requireRole("OWNER"),
    controller.listHistory
  );
  router.put(
    "/:id/price",
    requireAuth,
    requireRole("OWNER", "CASHIER"),
    controller.updatePrice
  );

  return router;
}
