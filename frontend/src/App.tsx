import { useState } from "react";
import { MainLayout } from "./components/layout/MainLayout";
import { CashierDashboard } from "./features/dashboard/components/CashierDashboard";
import { NewInvoicePage } from "./features/invoices/components/NewInvoicePage";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [screen, setScreen] = useState<"dashboard" | "invoice">("dashboard");

  return (
    <MainLayout
      menuOpen={menuOpen}
      onOpenMenu={() => setMenuOpen(true)}
      onCloseMenu={() => setMenuOpen(false)}
      currentScreen={screen}
      onNavigateDashboard={() => setScreen("dashboard")}
      onNavigateNewInvoice={() => setScreen("invoice")}
    >
      {screen === "dashboard" ? (
        <CashierDashboard onCreateInvoice={() => setScreen("invoice")} />
      ) : (
        <NewInvoicePage onCancel={() => setScreen("dashboard")} />
      )}
    </MainLayout>
  );
}
