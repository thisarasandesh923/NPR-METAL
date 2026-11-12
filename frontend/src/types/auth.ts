export const USER_ROLES = ["OWNER", "CASHIER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export type AppScreen = "owner-dashboard" | "cashier-dashboard" | "new-invoice";

export function isValidUserRole(value: unknown): value is UserRole {
  return value === "OWNER" || value === "CASHIER";
}

export function isValidAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.username === "string" &&
    candidate.username.length > 0 &&
    typeof candidate.fullName === "string" &&
    candidate.fullName.length > 0 &&
    isValidUserRole(candidate.role)
  );
}
