import { describe, expect, it } from "vitest";
import { certCoversHosts } from "../src/cluster-cert.js";

describe("certCoversHosts — FR-037 cert refresh subset semantics", () => {
  it("returns true when every configured host has a matching wildcard SAN", () => {
    expect(certCoversHosts(["*.dev.ix", "*.luna.ix"], ["dev.ix"])).toBe(true);
    expect(
      certCoversHosts(["*.dev.ix", "*.luna.ix"], ["dev.ix", "luna.ix"]),
    ).toBe(true);
  });

  it("returns false when any configured host is missing", () => {
    expect(certCoversHosts(["*.dev.ix"], ["dev.ix", "luna.ix"])).toBe(false);
    expect(certCoversHosts([], ["dev.ix"])).toBe(false);
  });

  it("tolerates extra SANs in the cert", () => {
    expect(
      certCoversHosts(["*.dev.ix", "*.luna.ix", "*.demo.ix"], ["dev.ix"]),
    ).toBe(true);
  });

  it("requires the wildcard form, not the bare host", () => {
    expect(certCoversHosts(["dev.ix"], ["dev.ix"])).toBe(false);
  });

  it("returns true vacuously when no hosts are configured", () => {
    expect(certCoversHosts([], [])).toBe(true);
    expect(certCoversHosts(["*.dev.ix"], [])).toBe(true);
  });

  it("is case-sensitive (matches kubectl/x509 SAN exactness)", () => {
    expect(certCoversHosts(["*.DEV.IX"], ["dev.ix"])).toBe(false);
  });
});
