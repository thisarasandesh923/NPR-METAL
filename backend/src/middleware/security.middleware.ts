import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../errors/appError.js";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Vary", "Origin");

  if (req.path.startsWith("/api")) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );
    res.setHeader("Pragma", "no-cache");
  }

  next();
}

export function createCorsAndOriginMiddleware(
  allowedOrigins: ReadonlySet<string>,
  _isProduction: boolean
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const originHeader = req.get("origin");
    const secFetchSite = req.get("sec-fetch-site")?.trim().toLowerCase();

    if (originHeader !== undefined) {
      if (!allowedOrigins.has(originHeader)) {
        next(
          new ForbiddenError(
            "Cross-origin requests from this origin are not allowed.",
            "ORIGIN_NOT_ALLOWED"
          )
        );
        return;
      }

      res.setHeader("Access-Control-Allow-Origin", originHeader);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Requested-With, X-NPR-CSRF"
      );
      res.setHeader("Access-Control-Max-Age", "600");
    } else {
      if (secFetchSite === "cross-site") {
        next(
          new ForbiddenError(
            "Cross-site requests without an allowed origin are not permitted.",
            "ORIGIN_NOT_ALLOWED"
          )
        );
        return;
      }

      if (STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
        const refererHeader = req.get("referer");
        if (refererHeader !== undefined) {
          let refererOrigin: string | null = null;
          try {
            refererOrigin = new URL(refererHeader).origin;
          } catch {
            refererOrigin = null;
          }
          if (!refererOrigin || !allowedOrigins.has(refererOrigin)) {
            next(
              new ForbiddenError(
                "Request referer origin is not allowed.",
                "ORIGIN_NOT_ALLOWED"
              )
            );
            return;
          }
        }
      }
    }

    if (req.method.toUpperCase() === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

export function requireCsrfHeaderMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const xRequestedWith = req.get("x-requested-with");
  const xNprCsrf = req.get("x-npr-csrf");

  if (xRequestedWith === "XMLHttpRequest" || xNprCsrf === "1") {
    next();
    return;
  }

  next(
    new ForbiddenError(
      "Missing or invalid CSRF protection header.",
      "CSRF_VALIDATION_FAILED"
    )
  );
}
