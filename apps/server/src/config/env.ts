// Maps SIM_* environment variables onto config leaf dot-paths (spec section
// 8.3). Only the leaves an environment variable supplies are locked; nothing
// else. Comma-separated lists are supported for allowlist variables.

export interface EnvLeaf {
  path: string;
  value: unknown;
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function readEnvOverlay(env: NodeJS.ProcessEnv = process.env): EnvLeaf[] {
  const leaves: EnvLeaf[] = [];
  const push = (path: string, raw: string | undefined, transform: (v: string) => unknown = (v) => v) => {
    if (raw !== undefined && raw !== "") leaves.push({ path, value: transform(raw) });
  };

  push("server.port", env.SIM_PORT, (v) => Number.parseInt(v, 10));
  push("server.publicUrl", env.SIM_PUBLIC_URL);
  push("credentials.secretKey", env.SIM_SECRET_KEY);
  push("credentials.publicKey", env.SIM_PUBLIC_KEY);
  push("credentials.apiKey", env.SIM_API_KEY);
  push("credentials.hmacSecret", env.SIM_HMAC_SECRET);
  push("security.adminToken", env.SIM_ADMIN_TOKEN);
  push("defaults.notificationUrl", env.SIM_DEFAULT_NOTIFICATION_URL);
  push("defaults.redirectionUrl", env.SIM_DEFAULT_REDIRECTION_URL);
  push("security.allowedWebhookHosts", env.SIM_ALLOWED_WEBHOOK_HOSTS, csv);
  push("browser.allowedRedirectOrigins", env.SIM_ALLOWED_REDIRECT_ORIGINS, csv);
  push("browser.allowedFrameAncestors", env.SIM_ALLOWED_FRAME_ANCESTORS, csv);
  push("defaults.validationMode", env.SIM_VALIDATION_MODE);
  push("clock.mode", env.SIM_CLOCK_MODE);
  push("features.enableLegacy", env.SIM_ENABLE_LEGACY, (v) => v === "1" || v === "true");
  push("features.enablePixelShim", env.SIM_ENABLE_PIXEL_SHIM, (v) => v === "1" || v === "true");

  return leaves;
}

export function readRuntimeEnv(env: NodeJS.ProcessEnv = process.env) {
  return {
    dataDir: env.SIM_DATA_DIR ?? "/data",
    configFile: env.SIM_CONFIG_FILE,
    logLevel: env.SIM_LOG_LEVEL ?? "info",
    tlsCertFile: env.SIM_TLS_CERT_FILE,
    tlsKeyFile: env.SIM_TLS_KEY_FILE,
  };
}
