/**
 * TC-405–TC-412: pure-function tests for the values overlays consumed
 * by `helm upgrade --reuse-values -f`.
 *   FR-038 (Cloudflare tunnel exposure).
 *
 * Override path note: every service-wrapper chart at this org composes
 * `ix-service` as a named subchart. The tunnel toggle therefore lives
 * at `ix-service.ingress.exposeOnTunnel` (single-service release) or
 * `<entry>.ix-service.ingress.exposeOnTunnel` (umbrella release), NOT
 * at the wrapper-chart's own `ingress.<key>`. Writing at the wrapper
 * level would silently no-op, which for a security-sensitive toggle
 * would be worse than not having the flag at all.
 */

import { describe, it, expect } from "vitest";
import {
  buildExposeOverlay,
  buildUnexposeOverlay,
  deriveHostname,
} from "../../src/tunnel/expose.js";

describe("deriveHostname", () => {
  it("TC-405: derives '<app>.<baseDomain>'", () => {
    expect(deriveHostname("cloud-manager", "agent-ix.dev")).toBe(
      "cloud-manager.agent-ix.dev",
    );
  });
});

describe("buildExposeOverlay (service / no entry key)", () => {
  it("TC-406: adds baseDomain to empty tunnelBaseDomains and flips ix-service.ingress.exposeOnTunnel", () => {
    const overlay = buildExposeOverlay({}, "agent-ix.dev", null, null) as {
      global: { tunnelBaseDomains: string[] };
      "ix-service": { ingress: { exposeOnTunnel: boolean } };
    };
    expect(overlay.global.tunnelBaseDomains).toEqual(["agent-ix.dev"]);
    expect(overlay["ix-service"].ingress.exposeOnTunnel).toBe(true);
  });

  it("TC-406b: leaves LAN keys untouched (extraBaseDomains, exposeExtraHosts)", () => {
    const overlay = buildExposeOverlay(
      {
        global: { extraBaseDomains: ["luna.ix"] },
        "ix-service": { ingress: { exposeExtraHosts: true } },
      },
      "agent-ix.dev",
      null,
      null,
    ) as {
      global: { extraBaseDomains?: string[]; tunnelBaseDomains: string[] };
      "ix-service": {
        ingress: { exposeExtraHosts?: boolean; exposeOnTunnel: boolean };
      };
    };
    expect(overlay.global.extraBaseDomains).toEqual(["luna.ix"]);
    expect(overlay.global.tunnelBaseDomains).toEqual(["agent-ix.dev"]);
    expect(overlay["ix-service"].ingress.exposeExtraHosts).toBe(true);
    expect(overlay["ix-service"].ingress.exposeOnTunnel).toBe(true);
  });

  it("TC-407: idempotent — re-exposing does not duplicate baseDomain", () => {
    const overlay = buildExposeOverlay(
      { global: { tunnelBaseDomains: ["agent-ix.dev"] } },
      "agent-ix.dev",
      null,
      null,
    ) as { global: { tunnelBaseDomains: string[] } };
    expect(overlay.global.tunnelBaseDomains).toEqual(["agent-ix.dev"]);
  });

  it("TC-408: hostname override appends to ix-service.ingress.extraHosts", () => {
    const overlay = buildExposeOverlay(
      {},
      "agent-ix.dev",
      null,
      "alias.agent-ix.dev",
    ) as {
      "ix-service": {
        ingress: { extraHosts: string[]; exposeOnTunnel: boolean };
      };
    };
    expect(overlay["ix-service"].ingress.extraHosts).toEqual([
      "alias.agent-ix.dev",
    ]);
    expect(overlay["ix-service"].ingress.exposeOnTunnel).toBe(true);
  });
});

describe("buildExposeOverlay (umbrella app / entry key)", () => {
  it("TC-409: routes ingress flip through subchart's ix-service block, preserves siblings", () => {
    const current = {
      global: { extraBaseDomains: ["luna.ix"] },
      "cloud-manager-ui": {
        "ix-service": {
          fullnameOverride: "cloud-manager-ui",
          ingress: { extraHosts: ["custom.dev.ix"] },
        },
      },
      "cloud-manager-api": {
        "ix-service": { somethingElse: true },
      },
    };
    const overlay = buildExposeOverlay(
      current,
      "agent-ix.dev",
      "cloud-manager-ui",
      null,
    ) as Record<string, unknown> & {
      global: { extraBaseDomains: string[]; tunnelBaseDomains: string[] };
      "cloud-manager-ui": {
        "ix-service": {
          fullnameOverride: string;
          ingress: { exposeOnTunnel: boolean; extraHosts: string[] };
        };
      };
    };
    expect(overlay.global.extraBaseDomains).toEqual(["luna.ix"]);
    expect(overlay.global.tunnelBaseDomains).toEqual(["agent-ix.dev"]);
    // Toggle landed on the deep ix-service path, not the wrapper.
    expect(
      overlay["cloud-manager-ui"]["ix-service"].ingress.exposeOnTunnel,
    ).toBe(true);
    expect(
      overlay["cloud-manager-ui"]["ix-service"].ingress.extraHosts,
    ).toEqual(["custom.dev.ix"]);
    // fullnameOverride and other ix-service block keys must round-trip
    // (we won't be `--reuse-values`-ing them otherwise).
    expect(overlay["cloud-manager-ui"]["ix-service"].fullnameOverride).toBe(
      "cloud-manager-ui",
    );
    // Sibling subchart MUST be absent from the overlay so `helm
    // upgrade --reuse-values -f` keeps its existing values intact.
    expect(overlay["cloud-manager-api"]).toBeUndefined();
  });
});

describe("buildUnexposeOverlay", () => {
  it("TC-410: removes baseDomain from tunnelBaseDomains and turns ix-service.ingress.exposeOnTunnel off", () => {
    const overlay = buildUnexposeOverlay(
      {
        global: { tunnelBaseDomains: ["agent-ix.dev"] },
        "ix-service": { ingress: { exposeOnTunnel: true } },
      },
      "agent-ix.dev",
      null,
    ) as {
      global: { tunnelBaseDomains: string[] };
      "ix-service": {
        ingress: { exposeOnTunnel: boolean; extraHosts: string[] };
      };
    };
    expect(overlay.global.tunnelBaseDomains).toEqual([]);
    expect(overlay["ix-service"].ingress.exposeOnTunnel).toBe(false);
  });

  it("TC-410b: leaves LAN keys untouched on unexpose", () => {
    const overlay = buildUnexposeOverlay(
      {
        global: {
          extraBaseDomains: ["luna.ix"],
          tunnelBaseDomains: ["agent-ix.dev"],
        },
        "ix-service": {
          ingress: { exposeExtraHosts: true, exposeOnTunnel: true },
        },
      },
      "agent-ix.dev",
      null,
    ) as {
      global: { extraBaseDomains?: string[]; tunnelBaseDomains: string[] };
      "ix-service": {
        ingress: { exposeExtraHosts?: boolean; exposeOnTunnel: boolean };
      };
    };
    expect(overlay.global.extraBaseDomains).toEqual(["luna.ix"]);
    expect(overlay.global.tunnelBaseDomains).toEqual([]);
    expect(overlay["ix-service"].ingress.exposeExtraHosts).toBe(true);
    expect(overlay["ix-service"].ingress.exposeOnTunnel).toBe(false);
  });

  it("TC-411: strips ix-service.ingress.extraHosts entries that end with the removed suffix; keeps others", () => {
    const overlay = buildUnexposeOverlay(
      {
        "ix-service": {
          ingress: {
            exposeOnTunnel: true,
            extraHosts: [
              "alias.agent-ix.dev",
              "vanity.dev.ix",
              "another.agent-ix.dev",
            ],
          },
        },
      },
      "agent-ix.dev",
      null,
    ) as { "ix-service": { ingress: { extraHosts: string[] } } };
    expect(overlay["ix-service"].ingress.extraHosts).toEqual(["vanity.dev.ix"]);
  });

  it("TC-412: targets the entry subchart's ix-service block on umbrella apps without disturbing siblings", () => {
    const overlay = buildUnexposeOverlay(
      {
        global: { tunnelBaseDomains: ["agent-ix.dev"] },
        "cloud-manager-ui": {
          "ix-service": {
            ingress: { exposeOnTunnel: true, extraHosts: [] },
          },
        },
        "cloud-manager-api": { "ix-service": { unrelated: 1 } },
      },
      "agent-ix.dev",
      "cloud-manager-ui",
    ) as Record<string, unknown> & {
      "cloud-manager-ui": {
        "ix-service": { ingress: { exposeOnTunnel: boolean } };
      };
    };
    expect(
      overlay["cloud-manager-ui"]["ix-service"].ingress.exposeOnTunnel,
    ).toBe(false);
    // Sibling subchart MUST be absent from the overlay (kept by --reuse-values).
    expect(overlay["cloud-manager-api"]).toBeUndefined();
  });
});
