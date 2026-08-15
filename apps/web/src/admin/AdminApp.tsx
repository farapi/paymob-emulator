import { useEffect, useState } from "react";
import { useLocation, Route, Routes } from "react-router-dom";
import { CreditCard02, LogOut04, Send03, Settings01 } from "@untitledui/icons";
import { SidebarNavigationSimple } from "@/components/application/app-navigation/sidebar-navigation/sidebar-simple";
import { Button } from "@/components/base/buttons/button";
import { BadgeWithDot } from "@/components/base/badges/badges";
import type { NavItemType } from "@/components/application/app-navigation/config";
import { getSession, logout, setCsrfToken } from "./api.js";
import { LoginPage } from "./LoginPage.js";
import { TransactionsPage } from "./TransactionsPage.js";
import { TransactionDetailPage } from "./TransactionDetailPage.js";
import { DeliveriesPage } from "./DeliveriesPage.js";
import { DeliveryDetailPage } from "./DeliveryDetailPage.js";
import { SettingsPage } from "./SettingsPage.js";

type AuthState = "checking" | "signed-out" | "signed-in";

function useNavItems(): NavItemType[] {
  return [
    { label: "Transactions", href: "/__simulator/dashboard/transactions", icon: CreditCard02 },
    { label: "Deliveries", href: "/__simulator/dashboard/deliveries", icon: Send03 },
    { label: "Settings", href: "/__simulator/dashboard/settings", icon: Settings01 },
  ];
}

export function AdminApp() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const location = useLocation();
  const navItems = useNavItems();

  useEffect(() => {
    void getSession().then((session) => {
      if (session.authenticated && session.csrfToken) {
        setCsrfToken(session.csrfToken);
        setAuthState("signed-in");
      } else {
        setAuthState("signed-out");
      }
    });
  }, []);

  if (authState === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-primary">
        <p className="text-secondary">Loading...</p>
      </main>
    );
  }

  if (authState === "signed-out") {
    return <LoginPage onAuthenticated={() => setAuthState("signed-in")} />;
  }

  const handleLogout = async () => {
    await logout();
    setCsrfToken(null);
    setAuthState("signed-out");
  };

  return (
    <div className="flex min-h-screen bg-primary">
      <SidebarNavigationSimple
        activeUrl={location.pathname}
        items={navItems}
        showAccountCard={false}
        footerItems={[]}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-secondary bg-primary px-6 py-4">
          <BadgeWithDot type="pill-color" size="md" color="warning">
            Simulator admin -- no real payment data
          </BadgeWithDot>
          <Button size="sm" color="secondary" iconLeading={LogOut04} onPress={() => void handleLogout()}>
            Sign out
          </Button>
        </header>
        <main className="flex-1 overflow-auto px-6 py-6">
          <Routes>
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="transactions/:id" element={<TransactionDetailPage />} />
            <Route path="deliveries" element={<DeliveriesPage />} />
            <Route path="deliveries/:id" element={<DeliveryDetailPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<TransactionsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
