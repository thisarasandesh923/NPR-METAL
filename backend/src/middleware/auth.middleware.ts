import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { SecurityConfig } from "../config/securityConfig.js";
import { ForbiddenError, UnauthorizedError } from "../errors/appError.js";
import type { AuthService } from "../modules/auth/auth.service.js";
import {
  isValidUserRole,
  type AuthContext,
  type UserRole,
} from "../modules/auth/auth.types.js";
import {
  SESSION_COOKIE_NAME,
  formatClearSessionCookie,
  formatSessionCookie,
  parseCookies,
} from "../modules/auth/cookies.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function createRequireAuth(
  authService: AuthService,
  config: SecurityConfig
): RequestHandler {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const cookies = parseCookies(req.get("cookie"));
      const rawToken = cookies[SESSION_COOKIE_NAME];

      if (!rawToken) {
        next(new UnauthorizedError("Authentication required.", "UNAUTHORIZED"));
        return;
      }

      const result = await authService.authenticateSession(rawToken);
      req.auth = result.auth;

      if (result.renewedExpiresAt) {
        res.setHeader(
          "Set-Cookie",
          formatSessionCookie(
            rawToken,
            result.renewedExpiresAt,
            config.cookieSecure
          )
        );
      }

      next();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        res.setHeader(
          "Set-Cookie",
          formatClearSessionCookie(config.cookieSecure)
        );
      }
      next(err);
    }
  };
}

export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  const allowedSet = new Set<UserRole>(allowedRoles);

  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.auth?.user;
    if (!user) {
      next(new UnauthorizedError("Authentication required.", "UNAUTHORIZED"));
      return;
    }

    if (!isValidUserRole(user.role) || !allowedSet.has(user.role)) {
      next(
        new ForbiddenError(
          "You do not have permission to perform this action.",
          "FORBIDDEN"
        )
      );
      return;
    }

    next();
  };
}
