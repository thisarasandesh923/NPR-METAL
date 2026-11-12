import type { AppScreen, UserRole } from "../../types/auth.ts";
import type { IconName } from "../../types/invoice.ts";

export interface RoleNavItem {
  label: string;
  icon: IconName;
  screen?: AppScreen;
  badge?: "Demo" | "Phase 4";
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
        label: "Cashier Preview",
        icon: "cash",
        screen: "cashier-dashboard",
        badge: "Demo",
      },
      {
        label: "Invoice Simulation",
        icon: "invoice",
        screen: "new-invoice",
        badge: "Demo",
      },
      {
        label: "Sales Reports",
        icon: "sales",
        badge: "Phase 4",
        disabled: true,
      },
      {
        label: "Price Management",
        icon: "balance",
        badge: "Phase 4",
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
      badge: "Demo",
    },
    {
      label: "Invoice History",
      icon: "history",
      badge: "Phase 4",
      disabled: true,
    },
    {
      label: "Customers",
      icon: "customers",
      badge: "Phase 4",
      disabled: true,
    },
    {
      label: "Payments",
      icon: "payments",
      badge: "Phase 4",
      disabled: true,
    },
  ];
}
