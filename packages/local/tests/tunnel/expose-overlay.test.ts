/**
 * TC-405–TC-412: pure-function tests for the values overlays consumed
 * by `helm upgrade --reuse-values -f`.
 *   FR-038 (Cloudflare tunnel exposure).
 *
 * These cover the merge semantics — entry-key targeting, idempotent
 * inserts, hostname-override append, and the inverse unexpose merge.
 * No I/O, no helm, no cluster.
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
  it("TC-406: adds baseDomain to empty extraBaseDomains and flips top-level toggle", () => {
    const overlay = buildExposeOverlay({}, "agent-ix.dev", null, null) as {
      global: { extraBaseDomains: string[] };
      ingress: { exposeExtraHosts: boolean };
    };
    expect(overlay.global.extraBaseDomains).toEqual(["agent-ix.dev"]);
    expect(overlay.ingress.exposeExtraHosts).toBe(true);
  });

  it("TC-407: idempotent — re-exposing does not duplicate baseDomain", () => {
    const overlay = buildExposeOverlay(
      { global: { extraBaseDomains: ["agent-ix.dev"] } },
      "agent-ix.dev",
      null,
      null,
    ) as { global: { extraBaseDomains: string[] } };
    expect(overlay.global.extraBaseDomains).toEqual(["agent-ix.dev"]);
  });

  it("TC-408: hostname override appends to ingress.extraHosts", () => {
    const overlay = buildExposeOverlay(
      {},
      "agent-ix.dev",
      null,
      "alias.agent-ix.dev",
    ) as { ingress: { extraHosts: string[]; exposeExtraHosts: boolean } };
    expect(overlay.ingress.extraHosts).toEqual(["alias.agent-ix.dev"]);
    expect(overlay.ingress.exposeExtraHosts).toBe(true);
  });
});

describe("buildExposeOverlay (umbrella app / entry key)", () => {
  it("TC-409: routes ingress flip through subchart, preserves other subcharts", () => {
    const current = {
      global: { extraBaseDomains: ["luna.ix"] },
      "cloud-manager-ui": { ingress: { extraHosts: ["custom.dev.ix"] } },
      "cloud-manager-api": { somethingElse: true },
    };
    const overlay = buildExposeOverlay(
      current,
      "agent-ix.dev",
      "cloud-manager-ui",
      null,
    ) as Record<string, unknown> & {
      global: { extraBaseDomains: string[] };
      "cloud-manager-ui": {
        ingress: { exposeExtraHosts: boolean; extraHosts: string[] };
      };
    };
    expect(overlay.global.extraBaseDomains).toEqual([
      "luna.ix",
      "agent-ix.dev",
    ]);
    expect(overlay["cloud-manager-ui"].ingress.exposeExtraHosts).toBe(true);
    expect(overlay["cloud-manager-ui"].ingress.extraHosts).toEqual([
      "custom.dev.ix",
    ]);
    // Sibling subchart MUST be absent from the overlay so `helm
    // upgrade --reuse-values -f` keeps its existing values intact.
    expect(overlay["cloud-manager-api"]).toBeUndefined();
  });
});

describe("buildUnexposeOverlay", () => {
  it("TC-410: removes baseDomain from extras and turns toggle off", () => {
    const overlay = buildUnexposeOverlay(
      {
        global: { extraBaseDomains: ["luna.ix", "agent-ix.dev"] },
        ingress: { exposeExtraHosts: true },
      },
      "agent-ix.dev",
      null,
    ) as {
      global: { extraBaseDomains: string[] };
      ingress: { exposeExtraHosts: boolean; extraHosts: string[] };
    };
    expect(overlay.global.extraBaseDomains).toEqual(["luna.ix"]);
    expect(overlay.ingress.exposeExtraHosts).toBe(false);
  });

  it("TC-411: strips ingress.extraHosts entries that end with the removed suffix; keeps others", () => {
    const overlay = buildUnexposeOverlay(
      {
        ingress: {
          exposeExtraHosts: true,
          extraHosts: [
            "alias.agent-ix.dev",
            "vanity.dev.ix",
            "another.agent-ix.dev",
          ],
        },
      },
      "agent-ix.dev",
      null,
    ) as { ingress: { extraHosts: string[] } };
    expect(overlay.ingress.extraHosts).toEqual(["vanity.dev.ix"]);
  });

  it("TC-412: targets the entry subchart on umbrella apps without disturbing siblings", () => {
    const overlay = buildUnexposeOverlay(
      {
        global: { extraBaseDomains: ["agent-ix.dev"] },
        "cloud-manager-ui": {
          ingress: { exposeExtraHosts: true, extraHosts: [] },
        },
        "cloud-manager-api": { unrelated: 1 },
      },
      "agent-ix.dev",
      "cloud-manager-ui",
    ) as Record<string, unknown> & {
      "cloud-manager-ui": { ingress: { exposeExtraHosts: boolean } };
    };
    expect(overlay["cloud-manager-ui"].ingress.exposeExtraHosts).toBe(false);
    // Sibling subchart MUST be absent from the overlay (kept by --reuse-values).
    expect(overlay["cloud-manager-api"]).toBeUndefined();
  });
});
