import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Root-relative so the same built assets can be served under both
  // /unifiedcheckout/ and /__simulator/dashboard/ by the server (see
  // apps/server/src/checkout/static-routes.ts).
  base: "/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:8080",
      "/__simulator": {
        target: "http://localhost:8080",
        ws: true,
      },
      "/api": "http://localhost:8080",
    },
  },
});
