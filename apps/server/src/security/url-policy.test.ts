import { describe, expect, it } from "vitest";
import { parseAllowlist } from "./allowlist.js";
import { checkOutboundUrlPolicy, checkRedirectOriginPolicy } from "./url-policy.js";

describe("checkOutboundUrlPolicy", () => {
  const allowlist = parseAllowlist(["backend", "host.docker.internal", "127.0.0.1"]);

  it("allows an allowlisted hostname", () => {
    const r = checkOutboundUrlPolicy("http://backend:3000/webhooks/paymob", allowlist);
    expect(r.ok).toBe(true);
  });

  it("rejects a hostname outside the allowlist", () => {
    const r = checkOutboundUrlPolicy("http://evil.example.com/steal", allowlist);
    expect(r.ok).toBe(false);
  });

  it("rejects userinfo in the URL", () => {
    const r = checkOutboundUrlPolicy("http://user:pass@backend:3000/x", allowlist);
    expect(r.ok).toBe(false);
  });

  it("rejects non-HTTP(S) schemes", () => {
    const r = checkOutboundUrlPolicy("ftp://backend/x", allowlist);
    expect(r.ok).toBe(false);
  });

  it("allows an allowlisted IP literal but not an unlisted one", () => {
    expect(checkOutboundUrlPolicy("http://127.0.0.1:8080/x", allowlist).ok).toBe(true);
    expect(checkOutboundUrlPolicy("http://10.10.10.10/x", allowlist).ok).toBe(false);
  });

  it("does not let an allowlisted CIDR make an unlisted hostname valid", () => {
    const cidrAllowlist = parseAllowlist(["10.0.0.0/8"]);
    // "backend" is a DNS hostname, not an IP literal, so the CIDR entry must not apply to it.
    const r = checkOutboundUrlPolicy("http://backend/x", cidrAllowlist);
    expect(r.ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(checkOutboundUrlPolicy("not a url", allowlist).ok).toBe(false);
  });
});

describe("checkRedirectOriginPolicy", () => {
  const origins = ["http://localhost:3000", "http://localhost:5173"];

  it("allows an exact scheme://host:port match regardless of path/query", () => {
    const r = checkRedirectOriginPolicy("http://localhost:3000/payment/result?x=1", origins);
    expect(r.ok).toBe(true);
  });

  it("rejects a different port", () => {
    const r = checkRedirectOriginPolicy("http://localhost:4000/payment/result", origins);
    expect(r.ok).toBe(false);
  });

  it("rejects a different scheme", () => {
    const r = checkRedirectOriginPolicy("https://localhost:3000/payment/result", origins);
    expect(r.ok).toBe(false);
  });

  it("rejects userinfo", () => {
    const r = checkRedirectOriginPolicy("http://u:p@localhost:3000/x", origins);
    expect(r.ok).toBe(false);
  });
});
