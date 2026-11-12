import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { InvoicesController } from "./invoices.controller.js";
import type { InvoicesService } from "./invoices.service.js";

export function createInvoicesRouter(
  invoicesService: InvoicesService,
  requireAuth: RequestHandler
): Router {
  const router = Router();
  const controller = new InvoicesController(invoicesService);

  router.get("/", requireAuth, requireRole("OWNER", "CASHIER"), controller.list);
  router.get(
    "/:id",
    requireAuth,
    requireRole("OWNER", "CASHIER"),
    controller.getById
  );
  router.post(
    "/",
    requireAuth,
    requireRole("OWNER", "CASHIER"),
    controller.create
  );

  return router;
}
