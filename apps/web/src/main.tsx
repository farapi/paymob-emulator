import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "./shared/query-client.js";
import { App } from "./App.js";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("missing #root element");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/unifiedcheckout">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
