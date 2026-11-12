import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { MachinesController } from "./machines.controller.js";
import type { MachinesService } from "./machines.service.js";

export function createMachinesRouters(
  machinesService: MachinesService,
  requireAuth: RequestHandler
): { machinesRouter: Router; machineLogsRouter: Router } {
  const controller = new MachinesController(machinesService);

  const machinesRouter = Router();
  machinesRouter.get("/", requireAuth, requireRole("OWNER", "CASHIER"), controller.listMachines);
  machinesRouter.post("/", requireAuth, requireRole("OWNER"), controller.createMachine);
  machinesRouter.put("/:id", requireAuth, requireRole("OWNER"), controller.updateMachine);

  const machineLogsRouter = Router();
  machineLogsRouter.get("/", requireAuth, requireRole("OWNER", "CASHIER"), controller.listLogs);
  machineLogsRouter.post("/", requireAuth, requireRole("OWNER", "CASHIER"), controller.createLog);
  machineLogsRouter.put("/:id", requireAuth, requireRole("OWNER", "CASHIER"), controller.updateLog);
  machineLogsRouter.post("/:id/submit", requireAuth, requireRole("OWNER", "CASHIER"), controller.submitLog);
  machineLogsRouter.post("/:id/cancel", requireAuth, requireRole("OWNER", "CASHIER"), controller.cancelLog);
  machineLogsRouter.post("/:id/review", requireAuth, requireRole("OWNER"), controller.reviewLog);

  return { machinesRouter, machineLogsRouter };
}

