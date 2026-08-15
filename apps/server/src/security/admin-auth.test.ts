import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  createNewSession,
  generateRandomToken,
  hashSecretToken,
  hashSessionToken,
  verifySecretToken,
} from "./admin-auth.js";

describe("secret token hashing", () => {
  it("round-trips through argon2id hash/verify", async () => {
    const token = generateRandomToken();
    const hash = await hashSecretToken(token);
    expect(await verifySecretToken(token, hash)).toBe(true);
    expect(await verifySecretToken("wrong-token", hash)).toBe(false);
  });

  it("hashes never equal the plaintext or each other for the same input", async () => {
    const token = generateRandomToken();
    const hashA = await hashSecretToken(token);
    const hashB = await hashSecretToken(token);
    expect(hashA).not.toBe(token);
    expect(hashA).not.toBe(hashB); // argon2 salts each hash
  });
});

describe("session token hashing", () => {
  it("is deterministic (needed for DB lookup by hash)", () => {
    const token = "abc123";
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });
});

describe("constantTimeEqual", () => {
  it("matches equal strings and rejects different ones", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

describe("createNewSession", () => {
  it("sets 12h idle and 24h absolute expiry from the given instant", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const session = createNewSession(now);
    expect(session.idleExpiresAt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(session.absoluteExpiresAt.toISOString()).toBe("2026-08-15T12:00:00.000Z");
    expect(hashSessionToken(session.sessionToken)).toBe(session.sessionTokenHash);
  });
});
