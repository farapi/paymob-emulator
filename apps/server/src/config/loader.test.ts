import { describe, expect, it } from "vitest";
import { loadConfig } from "./loader.js";

describe("loadConfig precedence", () => {
  it("falls back to defaults with no env or overlays", () => {
    const cfg = loadConfig({ env: {} });
    expect(cfg.values.credentials.secretKey).toBe("sk_sim_local");
    expect(cfg.values.defaults.validationMode).toBe("realistic");
    expect(cfg.lockedPaths.size).toBe(0);
  });

  it("lets database settings override defaults", () => {
    const cfg = loadConfig({
      env: {},
      databaseSettings: [{ path: "defaults.validationMode", value: "strict_docs" }],
    });
    expect(cfg.values.defaults.validationMode).toBe("strict_docs");
    expect(cfg.leafSources.get("defaults.validationMode")).toBe("database");
    expect(cfg.lockedPaths.has("defaults.validationMode")).toBe(false);
  });

  it("lets env override database settings and locks the leaf", () => {
    const cfg = loadConfig({
      env: { SIM_VALIDATION_MODE: "permissive" },
      databaseSettings: [{ path: "defaults.validationMode", value: "strict_docs" }],
    });
    expect(cfg.values.defaults.validationMode).toBe("permissive");
    expect(cfg.leafSources.get("defaults.validationMode")).toBe("env");
    expect(cfg.lockedPaths.has("defaults.validationMode")).toBe(true);
  });

  it("parses comma-separated allowlist env vars", () => {
    const cfg = loadConfig({
      env: { SIM_ALLOWED_REDIRECT_ORIGINS: "http://localhost:3000, http://localhost:5173" },
    });
    expect(cfg.values.browser.allowedRedirectOrigins).toEqual([
      "http://localhost:3000",
      "http://localhost:5173",
    ]);
  });

  it("only locks the specific leaf an env var supplies, not the whole section", () => {
    const cfg = loadConfig({ env: { SIM_SECRET_KEY: "sk_sim_custom" } });
    expect(cfg.lockedPaths.has("credentials.secretKey")).toBe(true);
    expect(cfg.lockedPaths.has("credentials.publicKey")).toBe(false);
  });
});
