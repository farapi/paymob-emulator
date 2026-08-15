import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { getSession, logout, setCsrfToken } from "./api.js";
import { LoginPage } from "./LoginPage.js";
import { TransactionsPage } from "./TransactionsPage.js";
import { TransactionDetailPage } from "./TransactionDetailPage.js";
import { DeliveriesPage } from "./DeliveriesPage.js";
import { DeliveryDetailPage } from "./DeliveryDetailPage.js";
import { SettingsPage } from "./SettingsPage.js";

type AuthState = "checking" | "signed-out" | "signed-in";

export function AdminApp() {
  const [authState, setAuthState] = useState<AuthState>("checking");

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
      <main className="admin-login">
        <p>Loading...</p>
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
    <div className="admin">
      <header className="admin__header">
        <div className="checkout__banner" style={{ margin: 0, flex: 1 }}>
          SIMULATOR ADMIN -- no real payment data
        </div>
      </header>
      <nav className="admin__nav">
        <NavLink to="/__simulator/dashboard/transactions" className={({ isActive }) => (isActive ? "active" : "")}>
          Transactions
        </NavLink>
        <NavLink to="/__simulator/dashboard/deliveries" className={({ isActive }) => (isActive ? "active" : "")}>
          Deliveries
        </NavLink>
        <NavLink to="/__simulator/dashboard/settings" className={({ isActive }) => (isActive ? "active" : "")}>
          Settings
        </NavLink>
        <button type="button" className="admin__logout" onClick={() => void handleLogout()}>
          Sign out
        </button>
      </nav>
      <main className="admin__content">
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
  );
}
