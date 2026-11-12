export const USER_ROLES = ["OWNER", "CASHIER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface SafeAuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

export interface AuthContext {
  user: SafeAuthUser;
  sessionId: string;
  expiresAt: Date;
}

export interface UserAuthRow {
  id: string;
  username: string;
  password_hash: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

export interface SessionAuthRow {
  session_id: string;
  expires_at: Date;
  created_at: Date;
  id: string;
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

export function isValidUserRole(value: unknown): value is UserRole {
  return value === "OWNER" || value === "CASHIER";
}
