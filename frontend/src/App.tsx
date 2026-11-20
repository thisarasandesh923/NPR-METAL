import { useEffect, useRef, useState } from "react";
import { MainLayout } from "./components/layout/MainLayout.tsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.tsx";
import { AuthProvider, useAuth } from "./context/AuthContext.tsx";
import { LanguageProvider } from "./i18n/LanguageContext.tsx";
import { OwnerApprovalsPage } from "./features/approvals/OwnerApprovalsPage.tsx";
import {
  clearSavedNavigation,
  getDefaultScreenForRole,
  getSavedNavigation,
  resolveAuthorizedScreen,
  saveNavigation,
} from "./features/auth/authNavigation.ts";
import { ProtectedRoute } from "./features/auth/components/ProtectedRoute.tsx";
import { CashierDashboard } from "./features/dashboard/components/CashierDashboard.tsx";
import { InvoiceDetailPage } from "./features/invoices/components/InvoiceDetailPage.tsx";
import { InvoiceHistoryPage } from "./features/invoices/components/InvoiceHistoryPage.tsx";
import { NewInvoicePage } from "./features/invoices/components/NewInvoicePage.tsx";
import { MaterialPricesPage } from "./features/materials/MaterialPricesPage.tsx";
import { DailyOperationsPage } from "./features/operations/DailyOperationsPage.tsx";
import { WorkersMachinesPage } from "./features/operations/WorkersMachinesPage.tsx";
import { OwnerDashboard } from "./features/owner/components/OwnerDashboard.tsx";
import { PayrollPage } from "./features/payroll/PayrollPage.tsx";
import type { AppScreen } from "./types/auth.ts";

export function AuthenticatedAppShell() {
  const { user, logout, isLoggingOut, logoutError } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // Initialize screen state: restore from sessionStorage if available for authenticated user, else role default
  const [screenState, setScreenState] = useState<{
    userId: string | null;
    screen: AppScreen;
    selectedInvoiceId?: number;
  }>(() => {
    if (user) {
      const saved = getSavedNavigation(user);
      if (saved) {
        return {
          userId: user.id,
          screen: saved.screen,
          selectedInvoiceId: saved.selectedInvoiceId,
        };
      }
      return {
        userId: user.id,
        screen: getDefaultScreenForRole(user.role),
      };
    }
    return { userId: null, screen: "cashier-dashboard" };
  });

  // Track the authenticated user identity (id + role) to avoid resetting navigation on object reference changes
  const prevUserKeyRef = useRef<string | null>(
    user ? `${user.id}:${user.role}` : null
  );

  useEffect(() => {
    if (!user) {
      prevUserKeyRef.current = null;
      setMenuOpen(false);
      return;
    }

    const currentUserKey = `${user.id}:${user.role}`;

    // Only re-initialize navigation when the authenticated user identity or role actually changes
    if (prevUserKeyRef.current !== currentUserKey) {
      prevUserKeyRef.current = currentUserKey;
      setMenuOpen(false);

      const saved = getSavedNavigation(user);
      if (saved) {
        setScreenState({
          userId: user.id,
          screen: saved.screen,
          selectedInvoiceId: saved.selectedInvoiceId,
        });
      } else {
        setScreenState({
          userId: user.id,
          screen: getDefaultScreenForRole(user.role),
        });
      }
    }
  }, [user?.id, user?.role]);

  return (
    <ProtectedRoute>
      {user && (() => {
        const activeScreen = (() => {
          if (screenState.userId !== user.id) {
            return getDefaultScreenForRole(user.role);
          }
          const authorized = resolveAuthorizedScreen(user.role, screenState.screen);
          if (
            authorized === "invoice-detail" &&
            (!screenState.selectedInvoiceId || screenState.selectedInvoiceId <= 0)
          ) {
            return "invoices";
          }
          return authorized;
        })();

        const navigateTo = (nextScreen: AppScreen, invoiceId?: number) => {
          const authorized = resolveAuthorizedScreen(user.role, nextScreen);
          const effectiveScreen =
            authorized === "invoice-detail" && (!invoiceId || invoiceId <= 0)
              ? "invoices"
              : authorized;
          const effectiveInvoiceId =
            effectiveScreen === "invoice-detail" ? invoiceId : undefined;

          saveNavigation(user, effectiveScreen, effectiveInvoiceId);
          setScreenState({
            userId: user.id,
            screen: effectiveScreen,
            selectedInvoiceId: effectiveInvoiceId,
          });
        };

        const openInvoice = (invoiceId: number) => {
          navigateTo("invoice-detail", invoiceId);
        };

        const handleLogout = async () => {
          clearSavedNavigation();
          await logout();
        };

        return (
          <MainLayout
            user={user}
            menuOpen={menuOpen}
            onOpenMenu={() => setMenuOpen(true)}
            onCloseMenu={() => setMenuOpen(false)}
            currentScreen={activeScreen}
            onNavigate={(s) => navigateTo(s)}
            onLogout={handleLogout}
            isLoggingOut={isLoggingOut}
            logoutError={logoutError}
          >
            <ErrorBoundary key={activeScreen} fallbackTitle="Page Error">
              {activeScreen === "owner-dashboard" ? (
                <ProtectedRoute
                  allowedRoles={["OWNER"]}
                  onFallbackHome={() =>
                    navigateTo(getDefaultScreenForRole(user.role))
                  }
                >
                  <OwnerDashboard
                    user={user}
                    onOpenHistory={() => navigateTo("invoices")}
                    onSelectInvoice={openInvoice}
                    onNavigate={(s) => navigateTo(s)}
                  />
                </ProtectedRoute>
              ) : activeScreen === "approvals" ? (
                <ProtectedRoute
                  allowedRoles={["OWNER"]}
                  onFallbackHome={() =>
                    navigateTo(getDefaultScreenForRole(user.role))
                  }
                >
                  <OwnerApprovalsPage />
                </ProtectedRoute>
              ) : activeScreen === "material-prices" ? (
                <ProtectedRoute
                  allowedRoles={["OWNER", "CASHIER"]}
                  onFallbackHome={() =>
                    navigateTo(getDefaultScreenForRole(user.role))
                  }
                >
                  <MaterialPricesPage />
                </ProtectedRoute>
              ) : activeScreen === "workers-machines" ? (
                <ProtectedRoute
                  allowedRoles={["OWNER"]}
                  onFallbackHome={() =>
                    navigateTo(getDefaultScreenForRole(user.role))
                  }
                >
                  <WorkersMachinesPage />
                </ProtectedRoute>
              ) : activeScreen === "payroll" ? (
                <ProtectedRoute
                  allowedRoles={["OWNER", "CASHIER"]}
                  onFallbackHome={() =>
                    navigateTo(getDefaultScreenForRole(user.role))
                  }
                >
                  <PayrollPage />
                </ProtectedRoute>
              ) : activeScreen === "daily-operations" ? (
                <DailyOperationsPage user={user} />
              ) : activeScreen === "new-invoice" ? (
                <NewInvoicePage
                  onCancel={() => navigateTo(getDefaultScreenForRole(user.role))}
                />
              ) : activeScreen === "invoices" ? (
                <InvoiceHistoryPage
                  onSelectInvoice={openInvoice}
                  onCreateInvoice={() => navigateTo("new-invoice")}
                />
              ) : activeScreen === "invoice-detail" &&
                screenState.selectedInvoiceId !== undefined ? (
                <InvoiceDetailPage
                  invoiceId={screenState.selectedInvoiceId}
                  userRole={user.role}
                  onBack={() => navigateTo("invoices")}
                  onCreateAnother={() => navigateTo("new-invoice")}
                />
              ) : activeScreen === "cashier-dashboard" ? (
                <ProtectedRoute
                  allowedRoles={["CASHIER"]}
                  onFallbackHome={() =>
                    navigateTo(getDefaultScreenForRole(user.role))
                  }
                >
                  <CashierDashboard
                    user={user}
                    onCreateInvoice={() => navigateTo("new-invoice")}
                    onOpenHistory={() => navigateTo("invoices")}
                    onSelectInvoice={openInvoice}
                  />
                </ProtectedRoute>
              ) : user.role === "OWNER" ? (
                <ProtectedRoute
                  allowedRoles={["OWNER"]}
                  onFallbackHome={() =>
                    navigateTo(getDefaultScreenForRole(user.role))
                  }
                >
                  <OwnerDashboard
                    user={user}
                    onOpenHistory={() => navigateTo("invoices")}
                    onSelectInvoice={openInvoice}
                    onNavigate={(s) => navigateTo(s)}
                  />
                </ProtectedRoute>
              ) : (
                <ProtectedRoute
                  allowedRoles={["CASHIER"]}
                  onFallbackHome={() =>
                    navigateTo(getDefaultScreenForRole(user.role))
                  }
                >
                  <CashierDashboard
                    user={user}
                    onCreateInvoice={() => navigateTo("new-invoice")}
                    onOpenHistory={() => navigateTo("invoices")}
                    onSelectInvoice={openInvoice}
                  />
                </ProtectedRoute>
              )}
            </ErrorBoundary>
          </MainLayout>
        );
      })()}
    </ProtectedRoute>
  );
}

export function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <AuthenticatedAppShell />
      </LanguageProvider>
    </AuthProvider>
  );
}

export default App;
