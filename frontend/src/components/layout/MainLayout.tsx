import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface MainLayoutProps {
  children: ReactNode;
  menuOpen: boolean;
  onCloseMenu: () => void;
  onOpenMenu: () => void;
  currentScreen: "dashboard" | "invoice";
  onNavigateDashboard: () => void;
  onNavigateNewInvoice: () => void;
}

export function MainLayout({
  children,
  menuOpen,
  onCloseMenu,
  onOpenMenu,
  currentScreen,
  onNavigateDashboard,
  onNavigateNewInvoice,
}: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <Sidebar
        open={menuOpen}
        onClose={onCloseMenu}
        onCreate={onNavigateNewInvoice}
        onDashboard={onNavigateDashboard}
        currentScreen={currentScreen}
      />
      <main className="min-h-screen lg:ml-[274px]">
        <Header onOpenMenu={onOpenMenu} currentScreen={currentScreen} />
        {children}
      </main>
    </div>
  );
}
