import type { AppScreen, UserRole } from "../../types/auth.ts";
import type { IconName } from "../../types/invoice.ts";

export interface RoleNavItem {
  label: string;
  icon: IconName;
  screen: AppScreen;
}

const OWNER_ONLY_SCREENS = new Set<AppScreen>([
  "owner-dashboard",
  "material-prices",
  "approvals",
  "workers-machines",
  "payroll",
]);

export function getDefaultScreenForRole(role: UserRole): AppScreen {
  return role === "OWNER" ? "owner-dashboard" : "cashier-dashboard";
}

export function canAccessScreen(role: UserRole, screen: AppScreen): boolean {
  if (OWNER_ONLY_SCREENS.has(screen)) {
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
        label: "Approvals Queue",
        icon: "check",
        screen: "approvals",
      },
      {
        label: "Price Management",
        icon: "balance",
        screen: "material-prices",
      },
      {
        label: "Daily Operations",
        icon: "documents",
        screen: "daily-operations",
      },
      {
        label: "Workers & Machines",
        icon: "customers",
        screen: "workers-machines",
      },
      {
        label: "Payroll & Expenses",
        icon: "payments",
        screen: "payroll",
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
      screen: "daily-operations",
    },
  ];
}
