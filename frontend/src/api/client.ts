const rawBaseUrl =
  typeof import.meta !== "undefined" && import.meta.env
    ? (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ""
    : "";
const API_BASE_URL = rawBaseUrl.replace(/\/+$/, "");
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface ApiErrorEnvelope {
  success: false;
  error: {
    code?: unknown;
    message?: unknown;
  };
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip triggering the global unauthorized callback (used during initial /me boot check or /login). */
  skipUnauthorizedHandler?: boolean;
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function parseRetryAfterSeconds(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const parsed = Number(headerValue.trim());
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.ceil(parsed);
  }
  return undefined;
}

export function formatRetryWaitDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) {
    return "a few minutes";
  }
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };

  if (STATE_CHANGING_METHODS.has(method)) {
    headers["X-Requested-With"] = "XMLHttpRequest";
  }

  let encodedBody: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    encodedBody = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: encodedBody,
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(
        0,
        "REQUEST_ABORTED",
        "The request timed out or was cancelled. Please try again."
      );
    }
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Unable to reach the authentication server. Please check your connection and try again."
    );
  }

  const retryAfterSeconds = parseRetryAfterSeconds(
    response.headers.get("retry-after")
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      if (response.status === 401 && !options.skipUnauthorizedHandler) {
        unauthorizedHandler?.();
      }
      throw new ApiError(
        response.status,
        "HTTP_ERROR",
        `Request failed with status ${response.status}.`,
        retryAfterSeconds
      );
    }
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "Received an invalid response from the server."
    );
  }

  if (!response.ok) {
    const errorObj = (payload as Partial<ApiErrorEnvelope> | null)?.error;
    const code =
      typeof errorObj?.code === "string" ? errorObj.code : "HTTP_ERROR";
    let message =
      typeof errorObj?.message === "string"
        ? errorObj.message
        : `Request failed with status ${response.status}.`;

    if (response.status === 429) {
      message = `Too many failed login attempts. Please wait ${formatRetryWaitDuration(retryAfterSeconds)} before trying again.`;
    }

    if (response.status === 401 && !options.skipUnauthorizedHandler) {
      unauthorizedHandler?.();
    }

    throw new ApiError(response.status, code, message, retryAfterSeconds);
  }

  const envelope = payload as Partial<ApiSuccessEnvelope<T>> | null;
  if (!envelope || envelope.success !== true || envelope.data === undefined) {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "Received an unexpected response structure from the server."
    );
  }

  return envelope.data;
}
