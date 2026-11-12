import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { CustomersController } from "./customers.controller.js";
import type { CustomersService } from "./customers.service.js";

export function createCustomersRouter(
  customersService: CustomersService,
  requireAuth: RequestHandler
): Router {
  const router = Router();
  const controller = new CustomersController(customersService);

  router.get(
    "/",
    requireAuth,
    requireRole("OWNER", "CASHIER"),
    controller.search
  );
  router.post(
    "/",
    requireAuth,
    requireRole("OWNER", "CASHIER"),
    controller.create
  );

  return router;
}
