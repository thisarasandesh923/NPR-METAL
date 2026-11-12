export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly headers?: Record<string, string>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    headers?: Record<string, string>
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.headers = headers;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid request input.", code = "VALIDATION_ERROR") {
    super(400, code, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = "Authentication required.",
    code = "UNAUTHORIZED"
  ) {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = "You do not have permission to perform this action.",
    code = "FORBIDDEN"
  ) {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found.", code = "NOT_FOUND") {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(
    message = "Request conflicts with current state.",
    code = "CONFLICT"
  ) {
    super(409, code, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(
    retryAfterSeconds: number,
    message = "Too many failed login attempts. Please try again later."
  ) {
    const safeRetry = Math.max(1, Math.ceil(retryAfterSeconds));
    super(429, "RATE_LIMIT_EXCEEDED", message, {
      "Retry-After": String(safeRetry),
    });
  }
}
