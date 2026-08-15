import { describe, expect, it } from "vitest";
import pino from "pino";
import { REDACT_PATHS } from "./logger.js";

// Exercises the same redact path list as createLogger, against a capturable
// in-memory stream (createLogger itself always attaches a pino-pretty
// transport outside test/production NODE_ENV, which doesn't expose a
// synchronous buffer to assert against).

function captureLogs() {
  const lines: string[] = [];
  const stream = {
    write(chunk: string) {
      lines.push(chunk);
    },
  };
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: "[redacted]" } }, stream as never);
  return { logger, lines };
}

describe("log redaction", () => {
  it("redacts secrets and PAN-shaped fields", () => {
    const { logger, lines } = captureLogs();
    logger.info({
      authorization: "Token sk_sim_local",
      apiKey: "api_sim_local",
      secretKey: "sk_sim_local",
      hmacSecret: "sim_hmac_secret",
      clientSecret: "csk_test_sim_secret",
      card_number: "4111111111111111",
      pan: "4111111111111111",
      cvv: "123",
      token: "tok_sim_abc",
      password: "hunter2",
      safeField: "keep-me",
    });

    const output = lines.join("\n");
    expect(output).toContain("[redacted]");
    expect(output).toContain("keep-me");
    expect(output).not.toContain("sk_sim_local");
    expect(output).not.toContain("sim_hmac_secret");
    expect(output).not.toContain("csk_test_sim_secret");
    expect(output).not.toContain("4111111111111111");
    expect(output).not.toContain("hunter2");
  });
});
