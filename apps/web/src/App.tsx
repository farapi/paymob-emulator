import { Route, Routes } from "react-router-dom";
import { CheckoutPage } from "./checkout/CheckoutPage.js";
import { AdminApp } from "./admin/AdminApp.js";

// The built assets are served under two server prefixes (see
// apps/server/src/checkout/static-routes.ts): /unifiedcheckout/ for the
// merchant-facing checkout page, and /__simulator/dashboard/ for the admin
// dashboard. Routing on the full pathname (rather than a fixed
// BrowserRouter basename) lets one bundle serve both.
export function App() {
  return (
    <Routes>
      <Route path="/__simulator/dashboard/*" element={<AdminApp />} />
      <Route path="/unifiedcheckout/*" element={<CheckoutPage />} />
      <Route path="*" element={<CheckoutPage />} />
    </Routes>
  );
}
