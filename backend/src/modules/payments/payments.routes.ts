import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { PaymentsController } from "./payments.controller.js";
import type { PaymentsService } from "./payments.service.js";

export function createPaymentsRouter(
  paymentsService: PaymentsService,
  requireAuth: RequestHandler
): Router {
  const router = Router();
  const controller = new PaymentsController(paymentsService);

  router.post(
    "/",
    requireAuth,
    requireRole("OWNER", "CASHIER"),
    controller.record
  );

  router.post(
    "/:id/adjust",
    requireAuth,
    requireRole("OWNER"),
    controller.adjust
  );

  return router;
}
