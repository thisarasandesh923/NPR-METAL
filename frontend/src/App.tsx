import { useEffect, useState } from "react";
import { MainLayout } from "./components/layout/MainLayout.tsx";
import { AuthProvider, useAuth } from "./context/AuthContext.tsx";
import {
  getDefaultScreenForRole,
  resolveAuthorizedScreen,
} from "./features/auth/authNavigation.ts";
import { ProtectedRoute } from "./features/auth/components/ProtectedRoute.tsx";
import { CashierDashboard } from "./features/dashboard/components/CashierDashboard.tsx";
import { NewInvoicePage } from "./features/invoices/components/NewInvoicePage.tsx";
import { OwnerDashboard } from "./features/owner/components/OwnerDashboard.tsx";
import type { AppScreen } from "./types/auth.ts";

export function AuthenticatedAppShell() {
  const { user, logout, isLoggingOut, logoutError } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [screenState, setScreenState] = useState<{
    userId: string | null;
    screen: AppScreen;
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

        const navigateTo = (nextScreen: AppScreen) => {
          setScreenState({
            userId: user.id,
            screen: resolveAuthorizedScreen(user.role, nextScreen),
          });
        };

        return (
          <MainLayout
            user={user}
            menuOpen={menuOpen}
            onOpenMenu={() => setMenuOpen(true)}
            onCloseMenu={() => setMenuOpen(false)}
            currentScreen={activeScreen}
            onNavigate={navigateTo}
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
                  onOpenCashierDemo={() => navigateTo("cashier-dashboard")}
                />
              </ProtectedRoute>
            ) : activeScreen === "new-invoice" ? (
              <NewInvoicePage
                onCancel={() =>
                  navigateTo(
                    user.role === "OWNER"
                      ? "cashier-dashboard"
                      : getDefaultScreenForRole(user.role)
                  )
                }
              />
            ) : (
              <CashierDashboard
                user={user}
                onCreateInvoice={() => navigateTo("new-invoice")}
              />
            )}
          </MainLayout>
        );
      })()}
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedAppShell />
    </AuthProvider>
  );
}
