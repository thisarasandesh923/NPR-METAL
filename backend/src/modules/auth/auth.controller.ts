import type { Request, Response } from "express";
import { z } from "zod";
import type { SecurityConfig } from "../../config/securityConfig.js";
import { UnauthorizedError, ValidationError } from "../../errors/appError.js";
import type { AuthService } from "./auth.service.js";
import {
  SESSION_COOKIE_NAME,
  formatClearSessionCookie,
  formatSessionCookie,
  parseCookies,
} from "./cookies.js";

const loginRequestSchema = z.object({
  username: z
    .string({ error: "Username is required." })
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(50, "Username must be at most 50 characters."),
  password: z
    .string({ error: "Password is required." })
    .min(1, "Password is required.")
    .max(200, "Password exceeds maximum length."),
});

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: SecurityConfig
  ) {}

  login = async (req: Request, res: Response): Promise<void> => {
    const parsed = loginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue =
        parsed.error.issues[0]?.message ?? "Invalid login request payload.";
      throw new ValidationError(firstIssue);
    }

    const cookies = parseCookies(req.get("cookie"));
    const existingSessionToken = cookies[SESSION_COOKIE_NAME];
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
    const userAgent = req.get("user-agent") ?? null;

    const result = await this.authService.login({
      username: parsed.data.username,
      password: parsed.data.password,
      ipAddress,
      userAgent,
      existingSessionToken,
    });

    res.setHeader(
      "Set-Cookie",
      formatSessionCookie(
        result.rawToken,
        result.expiresAt,
        this.config.cookieSecure
      )
    );

    res.status(200).json({
      success: true,
      data: {
        user: result.user,
      },
    });
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const cookies = parseCookies(req.get("cookie"));
    const rawToken = cookies[SESSION_COOKIE_NAME];
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown";

    await this.authService.logout({ rawToken, ipAddress });

    res.setHeader(
      "Set-Cookie",
      formatClearSessionCookie(this.config.cookieSecure)
    );

    res.status(200).json({
      success: true,
      data: {
        loggedOut: true,
      },
    });
  };

  me = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthorizedError("Authentication required.", "UNAUTHORIZED");
    }

    res.status(200).json({
      success: true,
      data: {
        user: req.auth.user,
      },
    });
  };
}
