import pino from "pino";

// Structured logging with secret/PAN redaction (spec section 21.1).

const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "apiKey",
  "api_key",
  "secretKey",
  "secret_key",
  "hmacSecret",
  "hmac_secret",
  "clientSecret",
  "client_secret",
  "card_number",
  "cardNumber",
  "pan",
  "cvv",
  "token",
  "password",
];

// Pino redact paths are fixed-depth, so both bare (top-level) and one-level-
// nested (`*.foo`, `req.headers.foo`) forms are listed. Call sites should
// avoid nesting secret-bearing fields deeper than this.
export const REDACT_PATHS = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((k) => `*.${k}`),
  "req.headers.authorization",
  "req.headers.cookie",
];

const PRETTY_TRANSPORT = {
  target: "pino-pretty",
  options: { colorize: true, translateTime: "HH:MM:ss.l" },
} as const;

export function createLogger(level = "info") {
  const usePretty = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    ...(usePretty ? { transport: PRETTY_TRANSPORT } : {}),
  });
}

export type AppLogger = ReturnType<typeof createLogger>;
