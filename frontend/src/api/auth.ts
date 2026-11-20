import { ApiError, apiRequest } from "./client.ts";
import { isValidAuthUser, type AuthUser, type UserRole } from "../types/auth.ts";

export interface LoginCredentials {
  username: string;
  password: string;
  portal?: UserRole;
}

interface AuthUserPayload {
  user: unknown;
}

interface LogoutPayload {
  loggedOut: boolean;
}

function assertValidAuthUser(rawUser: unknown): AuthUser {
  if (!isValidAuthUser(rawUser)) {
    throw new ApiError(
      500,
      "INVALID_USER_PAYLOAD",
      "Server returned an invalid authenticated user record."
    );
  }
  return rawUser;
}

export async function loginRequest(
  credentials: LoginCredentials
): Promise<AuthUser> {
  const data = await apiRequest<AuthUserPayload>("/api/auth/login", {
    method: "POST",
    body: {
      username: credentials.username,
      password: credentials.password,
      portal: credentials.portal,
    },
    skipUnauthorizedHandler: true,
  });

  return assertValidAuthUser(data.user);
}

export async function getCurrentSessionRequest(
  signal?: AbortSignal
): Promise<AuthUser | null> {
  try {
    const data = await apiRequest<AuthUserPayload>("/api/auth/me", {
      method: "GET",
      signal,
      skipUnauthorizedHandler: true,
    });
    return assertValidAuthUser(data.user);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return null;
    }
    throw err;
  }
}

export async function logoutRequest(): Promise<void> {
  try {
    await apiRequest<LogoutPayload>("/api/auth/logout", {
      method: "POST",
      skipUnauthorizedHandler: true,
    });
  } catch (err) {
    // If the session is already gone or expired on the server (401), logout still succeeds cleanly.
    if (err instanceof ApiError && err.status === 401) {
      return;
    }
    throw err;
  }
}
