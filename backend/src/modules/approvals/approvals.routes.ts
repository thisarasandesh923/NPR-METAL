import { Router, type RequestHandler } from "express";
import type { Pool } from "pg";
import { ValidationError } from "../../errors/appError.js";
import { requireRole } from "../../middleware/auth.middleware.js";
import { listMachineWorkLogs } from "../machines/machines.repository.js";
import { listProductionLogs } from "../production/production.repository.js";
import { listAttendanceRecords } from "../workers/workers.repository.js";
import {
  listOperationalHistory,
  type OperationalRecordType,
} from "./approvals.repository.js";

export function createApprovalsRouter(
  pool: Pool,
  requireAuth: RequestHandler
): Router {
  const router = Router();

  router.get(
    "/pending",
    requireAuth,
    requireRole("OWNER"),
    async (_req, res) => {
      const [attendance, machineLogs, productionLogs] = await Promise.all([
        listAttendanceRecords(pool, { status: "SUBMITTED", limit: 200 }),
        listMachineWorkLogs(pool, { status: "SUBMITTED", limit: 200 }),
        listProductionLogs(pool, { status: "SUBMITTED", limit: 200 }),
      ]);
      res.status(200).json({
        success: true,
        data: {
          pending: {
            attendance,
            machineLogs,
            productionLogs,
            totalCount:
              attendance.length + machineLogs.length + productionLogs.length,
          },
        },
      });
    }
  );

  router.get(
    "/history",
    requireAuth,
    requireRole("OWNER", "CASHIER"),
    async (req, res) => {
      const rt =
        typeof req.query.recordType === "string"
          ? req.query.recordType.trim()
          : undefined;
      if (
        rt &&
        rt !== "ATTENDANCE" &&
        rt !== "MACHINE_LOG" &&
        rt !== "PRODUCTION_LOG"
      ) {
        throw new ValidationError("Invalid recordType filter.");
      }
      const ridRaw =
        typeof req.query.recordId === "string"
          ? Number(req.query.recordId)
          : undefined;
      if (ridRaw !== undefined && (!Number.isInteger(ridRaw) || ridRaw <= 0)) {
        throw new ValidationError("Invalid recordId filter.");
      }

      const history = await listOperationalHistory(pool, {
        recordType: rt as OperationalRecordType | undefined,
        recordId: ridRaw,
        limit: 100,
      });

      res.status(200).json({
        success: true,
        data: { history },
      });
    }
  );

  return router;
}

