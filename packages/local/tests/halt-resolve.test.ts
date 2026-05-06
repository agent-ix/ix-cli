/**
 * TC-292, TC-293, TC-296, TC-297: resolveDownReleases()
 * FR-035 — pure helper that maps services + registry → release tuples for halt.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveDownReleases } from "../src/commands/halt-resolve.js";
import type { Deployable } from "../src/discovery.js";
import type { IxConfig } from "../src/config.js";

const config = {
  kindClusterName: "ix",
  helmChartRegistry: "ghcr.io",
  org: "agent-ix",
} as unknown as IxConfig;

const d = (
  name: string,
  role: Deployable["role"],
  namespace: string,
): Deployable => ({
  name,
  chartRepository: `agent-ix/${name}`,
  version: "0.1.0",
  role,
  title: null,
  category: null,
  tags: [],
  source: null,
  entry: null,
  namespace,
});

describe("resolveDownReleases", () => {
  it("TC-292: image-mode 'all' resolves every deployable in the registry", async () => {
    const registry = [
      d("auth", "app", "auth"),
      d("data", "app", "platform"),
      d("paperclip", "service", "paperclip"),
    ];
    const expandApp = vi.fn(async () => []);
    const releases = await resolveDownReleases(
      ["all"],
      registry,
      config,
      expandApp,
    );

    expect(releases.map((r) => r.name)).toEqual(
      expect.arrayContaining(["auth", "data", "paperclip"]),
    );
    expect(releases).toHaveLength(3);
  });

  it("TC-296: named service halt resolves only the named release, no expansion of others", async () => {
    const registry = [d("auth", "app", "auth"), d("data", "app", "platform")];
    const expandApp = vi.fn(async () => []);
    const releases = await resolveDownReleases(
      ["auth"],
      registry,
      config,
      expandApp,
    );

    expect(releases).toEqual([{ name: "auth", namespace: "auth" }]);
    expect(expandApp).toHaveBeenCalledTimes(1);
    expect(expandApp).toHaveBeenCalledWith(registry[0], config);
  });

  it("TC-293: app-role releases include umbrella + every subchart install (deduped)", async () => {
    const registry = [d("auth", "app", "auth")];
    const expandApp = vi.fn(async () => [
      { name: "identity", namespace: "auth" },
      { name: "auth-service", namespace: "auth" },
      // Duplicate of umbrella — must be deduped.
      { name: "auth", namespace: "auth" },
    ]);

    const releases = await resolveDownReleases(
      ["all"],
      registry,
      config,
      expandApp,
    );

    expect(releases).toEqual([
      { name: "auth", namespace: "auth" },
      { name: "identity", namespace: "auth" },
      { name: "auth-service", namespace: "auth" },
    ]);
  });

  it("TC-322: 'all' sorts dependents-before-dependencies (apps → auth → platform → system)", async () => {
    const registry = [
      // Intentionally registry order != tier order.
      d("system-thing", "service", "system"),
      d("data", "app", "platform"),
      d("auth", "app", "auth"),
      d("cloud-manager-app", "app", "apps"),
    ];
    const expandApp = vi.fn(async () => []);

    const releases = await resolveDownReleases(
      ["all"],
      registry,
      config,
      expandApp,
    );

    expect(releases.map((r) => `${r.namespace}/${r.name}`)).toEqual([
      "apps/cloud-manager-app",
      "auth/auth",
      "platform/data",
      "system/system-thing",
    ]);
  });

  it("TC-323: tier sort applies only to 'all' — named services preserve argv order", async () => {
    const registry = [
      d("data", "app", "platform"),
      d("auth", "app", "auth"),
      d("cloud-manager-app", "app", "apps"),
    ];
    const expandApp = vi.fn(async () => []);

    const releases = await resolveDownReleases(
      ["data", "auth", "cloud-manager-app"],
      registry,
      config,
      expandApp,
    );

    // Caller-specified order is preserved; tier sort is "all"-only.
    expect(releases.map((r) => r.name)).toEqual([
      "data",
      "auth",
      "cloud-manager-app",
    ]);
  });

  it("TC-324: dedupe preserves first-occurrence position", async () => {
    const registry = [d("a", "service", "apps"), d("b", "service", "apps")];
    const expandApp = vi.fn(async () => []);

    const releases = await resolveDownReleases(
      ["a", "b", "a"],
      registry,
      config,
      expandApp,
    );

    expect(releases.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("TC-325: unknown namespace falls to last in tier order", async () => {
    const registry = [
      d("auth", "app", "auth"),
      d("custom", "service", "weird-namespace"),
      d("data", "app", "platform"),
    ];
    const expandApp = vi.fn(async () => []);

    const releases = await resolveDownReleases(
      ["all"],
      registry,
      config,
      expandApp,
    );

    // Known tiers come first in their order; unknown tier ranks last.
    expect(releases.map((r) => r.namespace)).toEqual([
      "auth",
      "platform",
      "weird-namespace",
    ]);
  });
});
