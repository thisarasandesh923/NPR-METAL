import type { AppScreen, UserRole } from "../../types/auth.ts";
import type { IconName } from "../../types/invoice.ts";

export interface RoleNavItem {
  label: string;
  icon: IconName;
  screen?: AppScreen;
  badge?: "Planned";
  disabled?: boolean;
}

export function getDefaultScreenForRole(role: UserRole): AppScreen {
  return role === "OWNER" ? "owner-dashboard" : "cashier-dashboard";
}

export function canAccessScreen(role: UserRole, screen: AppScreen): boolean {
  if (screen === "owner-dashboard") {
    return role === "OWNER";
  }
  return role === "OWNER" || role === "CASHIER";
}

export function resolveAuthorizedScreen(
  role: UserRole,
  requestedScreen: AppScreen
): AppScreen {
  if (canAccessScreen(role, requestedScreen)) {
    return requestedScreen;
  }
  return getDefaultScreenForRole(role);
}

export function getNavItemsForRole(role: UserRole): RoleNavItem[] {
  if (role === "OWNER") {
    return [
      {
        label: "Owner Dashboard",
        icon: "dashboard",
        screen: "owner-dashboard",
      },
      {
        label: "Invoice History",
        icon: "history",
        screen: "invoices",
      },
      {
        label: "New Invoice",
        icon: "invoice",
        screen: "new-invoice",
      },
      {
        label: "Price Management",
        icon: "balance",
        badge: "Planned",
        disabled: true,
      },
      {
        label: "Operations & Payroll",
        icon: "customers",
        badge: "Planned",
        disabled: true,
      },
    ];
  }

  return [
    {
      label: "Cashier Dashboard",
      icon: "dashboard",
      screen: "cashier-dashboard",
    },
    {
      label: "New Invoice",
      icon: "invoice",
      screen: "new-invoice",
    },
    {
      label: "Invoice History",
      icon: "history",
      screen: "invoices",
    },
    {
      label: "Daily Operations",
      icon: "documents",
      badge: "Planned",
      disabled: true,
    },
  ];
}
