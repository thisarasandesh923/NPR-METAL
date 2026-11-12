import { Router, type RequestHandler } from "express";
import { requireRole } from "../../middleware/auth.middleware.js";
import { WorkersController } from "./workers.controller.js";
import type { WorkersService } from "./workers.service.js";

export function createWorkersRouters(
  workersService: WorkersService,
  requireAuth: RequestHandler
): { workersRouter: Router; attendanceRouter: Router } {
  const controller = new WorkersController(workersService);

  const workersRouter = Router();
  workersRouter.get("/", requireAuth, requireRole("OWNER", "CASHIER"), controller.listWorkers);
  workersRouter.post("/", requireAuth, requireRole("OWNER"), controller.createWorker);
  workersRouter.put("/:id", requireAuth, requireRole("OWNER"), controller.updateWorker);

  const attendanceRouter = Router();
  attendanceRouter.get("/", requireAuth, requireRole("OWNER", "CASHIER"), controller.listAttendance);
  attendanceRouter.post("/", requireAuth, requireRole("OWNER", "CASHIER"), controller.createAttendance);
  attendanceRouter.put("/:id", requireAuth, requireRole("OWNER", "CASHIER"), controller.updateAttendance);
  attendanceRouter.post("/:id/submit", requireAuth, requireRole("OWNER", "CASHIER"), controller.submitAttendance);
  attendanceRouter.post("/:id/cancel", requireAuth, requireRole("OWNER", "CASHIER"), controller.cancelAttendance);
  attendanceRouter.post("/:id/review", requireAuth, requireRole("OWNER"), controller.reviewAttendance);

  return { workersRouter, attendanceRouter };
}

