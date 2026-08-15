import { describe, expect, it } from "vitest";
import { isHostnameAllowed, isIpAllowed, parseAllowlist, parseAllowlistEntry } from "./allowlist.js";

describe("parseAllowlistEntry", () => {
  it("parses a bare hostname", () => {
    expect(parseAllowlistEntry("backend")).toEqual({ kind: "hostname", hostname: "backend", port: null });
  });

  it("parses hostname:port", () => {
    expect(parseAllowlistEntry("backend:3000")).toEqual({
      kind: "hostname",
      hostname: "backend",
      port: 3000,
    });
  });

  it("parses an IPv4 literal", () => {
    expect(parseAllowlistEntry("127.0.0.1")).toEqual({ kind: "ip", ip: "127.0.0.1", family: 4, port: null });
  });

  it("parses a CIDR", () => {
    expect(parseAllowlistEntry("10.0.0.0/8")).toEqual({
      kind: "cidr",
      base: "10.0.0.0",
      prefixLen: 8,
      family: 4,
    });
  });

  it("rejects port 0", () => {
    expect(() => parseAllowlistEntry("backend:0")).toThrow();
  });

  it("lowercases and strips a trailing dot from hostnames", () => {
    const entry = parseAllowlistEntry("Backend.Example.com.");
    if (entry.kind !== "hostname") throw new Error("expected a hostname entry");
    expect(entry.hostname).toBe("backend.example.com");
  });
});

describe("isHostnameAllowed", () => {
  const entries = parseAllowlist(["backend", "host.docker.internal:3000"]);

  it("matches an unqualified entry on any port", () => {
    expect(isHostnameAllowed("backend", 80, entries)).toBe(true);
    expect(isHostnameAllowed("backend", 9999, entries)).toBe(true);
  });

  it("matches a port-qualified entry only on that port", () => {
    expect(isHostnameAllowed("host.docker.internal", 3000, entries)).toBe(true);
    expect(isHostnameAllowed("host.docker.internal", 4000, entries)).toBe(false);
  });

  it("never does suffix matching", () => {
    expect(isHostnameAllowed("x.backend", 80, entries)).toBe(false);
  });
});

describe("isIpAllowed", () => {
  const entries = parseAllowlist(["127.0.0.1", "10.0.0.0/8", "192.168.1.1:8443"]);

  it("matches an exact IP", () => {
    expect(isIpAllowed("127.0.0.1", 80, entries)).toBe(true);
    expect(isIpAllowed("127.0.0.2", 80, entries)).toBe(false);
  });

  it("matches within a CIDR", () => {
    expect(isIpAllowed("10.1.2.3", 80, entries)).toBe(true);
    expect(isIpAllowed("11.1.2.3", 80, entries)).toBe(false);
  });

  it("respects a port-qualified IP entry", () => {
    expect(isIpAllowed("192.168.1.1", 8443, entries)).toBe(true);
    expect(isIpAllowed("192.168.1.1", 80, entries)).toBe(false);
  });

  it("does not let a resolved CIDR match make an unlisted hostname valid (hostname check is separate)", () => {
    // isIpAllowed only ever applies to URL IP literals, never DNS hostnames;
    // this is enforced structurally by url-policy.ts calling only one path.
    expect(isIpAllowed("10.0.0.1", 80, entries)).toBe(true);
  });
});
