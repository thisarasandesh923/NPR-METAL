import express, { type Express, type RequestHandler } from "express";
import type { Pool } from "pg";
import {
  resolveSecurityConfig,
  type SecurityConfig,
} from "./config/securityConfig.js";
import { requireRole } from "./middleware/auth.middleware.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import {
  createCorsAndOriginMiddleware,
  requireCsrfHeaderMiddleware,
  securityHeadersMiddleware,
} from "./middleware/security.middleware.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import type { UserRole } from "./modules/auth/auth.types.js";
import { createCustomersRouter } from "./modules/customers/customers.routes.js";
import { CustomersService } from "./modules/customers/customers.service.js";
import { createInvoicesRouter } from "./modules/invoices/invoices.routes.js";
import { InvoicesService } from "./modules/invoices/invoices.service.js";
import { createMaterialsRouter } from "./modules/materials/materials.routes.js";
import { MaterialsService } from "./modules/materials/materials.service.js";
import { createPaymentsRouter } from "./modules/payments/payments.routes.js";
import { PaymentsService } from "./modules/payments/payments.service.js";
import { createReportsRouter } from "./modules/reports/reports.routes.js";
import { ReportsService } from "./modules/reports/reports.service.js";

export interface AppDependencies {
  pool: Pool;
  securityConfig?: SecurityConfig;
  registerExtraRoutes?: (
    app: Express,
    guards: {
      requireAuth: RequestHandler;
      requireRole: (...roles: UserRole[]) => RequestHandler;
    }
  ) => void;
}

export function createApp(deps: AppDependencies): Express {
  const securityConfig = deps.securityConfig ?? resolveSecurityConfig();
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", securityConfig.trustProxy);

  app.use(securityHeadersMiddleware);
  app.use(
    createCorsAndOriginMiddleware(
      securityConfig.allowedOrigins,
      securityConfig.isProduction
    )
  );
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", requireCsrfHeaderMiddleware);

  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "NPR Metal Crusher API",
      timestamp: new Date().toISOString(),
    });
  });

  const authService = new AuthService(deps.pool, securityConfig);
  const { router: authRouter, requireAuth } = createAuthRouter(
    authService,
    securityConfig
  );
  app.use("/api/auth", authRouter);

  app.use(
    "/api/materials",
    createMaterialsRouter(new MaterialsService(deps.pool), requireAuth)
  );
  app.use(
    "/api/customers",
    createCustomersRouter(new CustomersService(deps.pool), requireAuth)
  );
  app.use(
    "/api/invoices",
    createInvoicesRouter(new InvoicesService(deps.pool), requireAuth)
  );
  app.use(
    "/api/payments",
    createPaymentsRouter(new PaymentsService(deps.pool), requireAuth)
  );
  app.use(
    "/api/reports",
    createReportsRouter(new ReportsService(deps.pool), requireAuth)
  );

  if (deps.registerExtraRoutes) {
    if (
      securityConfig.isProduction ||
      process.env.NODE_ENV?.trim().toLowerCase() === "production"
    ) {
      throw new Error(
        "Test-only registerExtraRoutes hook cannot be registered in production."
      );
    }
    deps.registerExtraRoutes(app, { requireAuth, requireRole });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}