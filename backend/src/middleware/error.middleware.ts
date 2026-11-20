import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/appError.js";

function isJsonSyntaxError(err: unknown): err is SyntaxError & { status?: number } {
  return (
    err instanceof SyntaxError &&
    "body" in err &&
    "status" in err &&
    err.status === 400
  );
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Endpoint not found.",
    },
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (isJsonSyntaxError(err)) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_JSON",
        message: "Malformed JSON request payload.",
      },
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.headers) {
      for (const [key, value] of Object.entries(err.headers)) {
        res.setHeader(key, value);
      }
    }
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // Log safe error metadata (code, SQLSTATE, routine, name, sanitized message) without exposing passwords, tokens or parameters
  const errObj = err instanceof Object ? (err as Record<string, unknown>) : {};
  const errorName = err instanceof Error ? err.name : "UnknownError";
  const errorCode =
    typeof errObj.code === "string" || typeof errObj.code === "number"
      ? String(errObj.code)
      : undefined;
  const routine = typeof errObj.routine === "string" ? errObj.routine : undefined;
  const severity = typeof errObj.severity === "string" ? errObj.severity : undefined;

  let safeMessage = err instanceof Error ? err.message : String(err);
  safeMessage = safeMessage.replace(/:\/\/([^:]+):([^@]+)@/g, "://$1:***@");

  const metaParts = [`name=${errorName}`];
  if (errorCode) {
    metaParts.push(`code=${errorCode}`);
  }
  if (severity) {
    metaParts.push(`severity=${severity}`);
  }
  if (routine) {
    metaParts.push(`routine=${routine}`);
  }

  console.error(
    `[ERROR] Unhandled server error (${metaParts.join(" ")}) — ${safeMessage}`
  );

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected internal error occurred.",
    },
  });
}