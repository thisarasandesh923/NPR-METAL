import type { AppScreen, UserRole } from "../../types/auth.ts";
import type { IconName } from "../../types/invoice.ts";

export interface RoleNavItem {
  label: string;
  icon: IconName;
  screen: AppScreen;
}

const OWNER_ONLY_SCREENS = new Set<AppScreen>([
  "owner-dashboard",
  "approvals",
  "workers-machines",
]);

const CASHIER_ONLY_SCREENS = new Set<AppScreen>([
  "cashier-dashboard",
]);

export function getDefaultScreenForRole(role: UserRole): AppScreen {
  return role === "OWNER" ? "owner-dashboard" : "cashier-dashboard";
}

export function canAccessScreen(role: UserRole, screen: AppScreen): boolean {
  if (OWNER_ONLY_SCREENS.has(screen)) {
    return role === "OWNER";
  }
  if (CASHIER_ONLY_SCREENS.has(screen)) {
    return role === "CASHIER";
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

export const NAV_STORAGE_KEY = "npr_nav_state";

export interface StoredNavigationState {
  userId: string;
  role: UserRole;
  screen: AppScreen;
  selectedInvoiceId?: number;
}

export function getSavedNavigation(user: { id: string; role: UserRole }): {
  screen: AppScreen;
  selectedInvoiceId?: number;
} | null {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(NAV_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.userId !== user.id ||
      parsed.role !== user.role ||
      typeof parsed.screen !== "string"
    ) {
      return null;
    }

    const authorized = resolveAuthorizedScreen(user.role, parsed.screen as AppScreen);

    // Requirement 9: if screen is invoice-detail, ensure selectedInvoiceId is a valid positive integer
    if (authorized === "invoice-detail") {
      const invoiceId = Number(parsed.selectedInvoiceId);
      if (Number.isInteger(invoiceId) && invoiceId > 0) {
        return { screen: "invoice-detail", selectedInvoiceId: invoiceId };
      }
      // If invoice ID is unavailable or invalid after refresh, safely fall back to invoices list
      return { screen: "invoices" };
    }

    return { screen: authorized };
  } catch {
    return null;
  }
}

export function saveNavigation(
  user: { id: string; role: UserRole },
  screen: AppScreen,
  selectedInvoiceId?: number
): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  try {
    const defaultScreen = getDefaultScreenForRole(user.role);
    // If user is on default dashboard, clear stored item so it naturally defaults to Dashboard while keeping storage empty
    if (screen === defaultScreen && !selectedInvoiceId) {
      window.sessionStorage.removeItem(NAV_STORAGE_KEY);
      return;
    }

    const authorized = resolveAuthorizedScreen(user.role, screen);
    const effectiveScreen =
      authorized === "invoice-detail" && (!selectedInvoiceId || selectedInvoiceId <= 0)
        ? "invoices"
        : authorized;
    const effectiveInvoiceId =
      effectiveScreen === "invoice-detail" ? selectedInvoiceId : undefined;

    const state: StoredNavigationState = {
      userId: user.id,
      role: user.role,
      screen: effectiveScreen,
      selectedInvoiceId: effectiveInvoiceId,
    };
    window.sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Graceful fallback on storage exceptions
  }
}

export function clearSavedNavigation(): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  try {
    window.sessionStorage.removeItem(NAV_STORAGE_KEY);
  } catch {
    // Ignore error
  }
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
      label: "Payroll & Expenses",
      icon: "payments",
      screen: "payroll",
    },
  ];
}
