import { useEffect, useState } from "react";
import { MainLayout } from "./components/layout/MainLayout.tsx";
import { AuthProvider, useAuth } from "./context/AuthContext.tsx";
import { LanguageProvider } from "./i18n/LanguageContext.tsx";
import { OwnerApprovalsPage } from "./features/approvals/OwnerApprovalsPage.tsx";
import {
  getDefaultScreenForRole,
  resolveAuthorizedScreen,
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
  const [screenState, setScreenState] = useState<{
    userId: string | null;
    screen: AppScreen;
    selectedInvoiceId?: number;
  }>({ userId: null, screen: "cashier-dashboard" });

  useEffect(() => {
    if (user) {
      setScreenState({
        userId: user.id,
        screen: getDefaultScreenForRole(user.role),
      });
      setMenuOpen(false);
    } else {
      setMenuOpen(false);
    }
  }, [user]);

  return (
    <ProtectedRoute>
      {user && (() => {
        const activeScreen =
          screenState.userId === user.id
            ? resolveAuthorizedScreen(user.role, screenState.screen)
            : getDefaultScreenForRole(user.role);

        const navigateTo = (nextScreen: AppScreen, invoiceId?: number) => {
          setScreenState({
            userId: user.id,
            screen: resolveAuthorizedScreen(user.role, nextScreen),
            selectedInvoiceId: invoiceId,
          });
        };

        const openInvoice = (invoiceId: number) => {
          navigateTo("invoice-detail", invoiceId);
        };

        return (
          <MainLayout
            user={user}
            menuOpen={menuOpen}
            onOpenMenu={() => setMenuOpen(true)}
            onCloseMenu={() => setMenuOpen(false)}
            currentScreen={activeScreen}
            onNavigate={(s) => navigateTo(s)}
            onLogout={logout}
            isLoggingOut={isLoggingOut}
            logoutError={logoutError}
          >
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
                allowedRoles={["OWNER"]}
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
                allowedRoles={["OWNER"]}
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
            ) : (
              <CashierDashboard
                user={user}
                onCreateInvoice={() => navigateTo("new-invoice")}
                onOpenHistory={() => navigateTo("invoices")}
                onSelectInvoice={openInvoice}
              />
            )}
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
