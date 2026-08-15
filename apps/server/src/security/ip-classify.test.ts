import { describe, expect, it } from "vitest";
import { checkBlockedRange, classifyIp } from "./ip-classify.js";

describe("classifyIp", () => {
  it("classifies the cloud metadata address", () => {
    expect(classifyIp("169.254.169.254").isMetadata).toBe(true);
    expect(classifyIp("169.254.169.254").isLinkLocal).toBe(true);
  });

  it("classifies private ranges", () => {
    expect(classifyIp("10.0.0.5").isPrivate).toBe(true);
    expect(classifyIp("172.16.0.1").isPrivate).toBe(true);
    expect(classifyIp("192.168.1.1").isPrivate).toBe(true);
    expect(classifyIp("8.8.8.8").isPrivate).toBe(false);
  });

  it("classifies loopback", () => {
    expect(classifyIp("127.0.0.1").isLoopback).toBe(true);
    expect(classifyIp("::1").isLoopback).toBe(true);
  });

  it("classifies multicast and unspecified", () => {
    expect(classifyIp("224.0.0.1").isMulticast).toBe(true);
    expect(classifyIp("0.0.0.0").isUnspecified).toBe(true);
  });

  it("classifies documentation ranges", () => {
    expect(classifyIp("192.0.2.1").isDocumentation).toBe(true);
    expect(classifyIp("198.51.100.1").isDocumentation).toBe(true);
    expect(classifyIp("203.0.113.1").isDocumentation).toBe(true);
  });
});

describe("checkBlockedRange", () => {
  it("always blocks the metadata address even when private networks are allowed", () => {
    expect(checkBlockedRange("169.254.169.254", true).blocked).toBe(true);
    expect(checkBlockedRange("169.254.169.254", false).blocked).toBe(true);
  });

  it("blocks loopback/private only when allowPrivateNetworks is false", () => {
    expect(checkBlockedRange("127.0.0.1", true).blocked).toBe(false);
    expect(checkBlockedRange("127.0.0.1", false).blocked).toBe(true);
    expect(checkBlockedRange("10.0.0.1", true).blocked).toBe(false);
    expect(checkBlockedRange("10.0.0.1", false).blocked).toBe(true);
  });

  it("allows a normal public address", () => {
    expect(checkBlockedRange("93.184.216.34", false).blocked).toBe(false);
  });
});
