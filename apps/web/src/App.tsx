import { Route, Routes } from "react-router-dom";
import { CheckoutPage } from "./checkout/CheckoutPage.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<CheckoutPage />} />
      <Route path="*" element={<CheckoutPage />} />
    </Routes>
  );
}
