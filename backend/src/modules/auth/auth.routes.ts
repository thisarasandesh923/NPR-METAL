import { Router, type RequestHandler } from "express";
import type { SecurityConfig } from "../../config/securityConfig.js";
import { createRequireAuth } from "../../middleware/auth.middleware.js";
import { AuthController } from "./auth.controller.js";
import type { AuthService } from "./auth.service.js";

export function createAuthRouter(
  authService: AuthService,
  config: SecurityConfig
): { router: Router; requireAuth: RequestHandler } {
  const router = Router();
  const controller = new AuthController(authService, config);
  const requireAuth = createRequireAuth(authService, config);

  router.post("/login", controller.login);
  router.post("/logout", controller.logout);
  router.get("/me", requireAuth, controller.me);

  return { router, requireAuth };
}
