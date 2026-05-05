/**
 * TC-022–TC-031: loadClusterConfig() and computeEffectiveDeploySet()
 * FR-009 (cluster defaults), FR-005 (deploy set algorithm).
 *
 * After slice 9: loadClusterConfig() routes through the shared
 * ConfigService; the legacy `~/.ix/config.yaml` path is gone. Tests
 * isolate XDG_CONFIG_HOME and seed `~/.config/ix/config.d/local.yaml`
 * directly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

function seedLocalYaml(content: string): void {
  const target = join(dir, "ix", "config.d");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  writeFileSync(join(target, "local.yaml"), content, { mode: 0o600 });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ix-local-cfg-"));
  process.env.XDG_CONFIG_HOME = dir;
  // Reset the shared registry so each test starts clean.
  const { _resetRegistryForTests } =
    await import("@agent-ix/ix-cli-core/src/config/registry.js");
  _resetRegistryForTests();
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("loadClusterConfig", () => {
  it("TC-022: missing config file returns defaults { defaultTags: ['ix-core'], extraApps: [], skipApps: [] }", async () => {
    const { loadClusterConfig } = await import("../src/config.js");
    const cfg = loadClusterConfig();
    expect(cfg).toEqual({
      defaultTags: ["ix-core"],
      extraApps: [],
      skipApps: [],
    });
  });

  it("TC-023: config with cluster key parsed correctly", async () => {
    seedLocalYaml(
      "cluster:\n  defaultTags: [ix-core, extra]\n  extraApps: [myapp]\n  skipApps: [skipme]\n",
    );
    const { loadClusterConfig } = await import("../src/config.js");
    const cfg = loadClusterConfig();
    expect(cfg.defaultTags).toEqual(["ix-core", "extra"]);
    expect(cfg.extraApps).toEqual(["myapp"]);
    expect(cfg.skipApps).toEqual(["skipme"]);
  });

  it("TC-024: malformed cluster.defaultTags falls back to defaults; incident recorded (FR-011-AC-1)", async () => {
    seedLocalYaml("cluster:\n  defaultTags: not-an-array\n");
    const [{ loadClusterConfig }, { listIncidents }] = await Promise.all([
      import("../src/config.js"),
      import("@agent-ix/ix-cli-core"),
    ]);
    // Per FR-011-AC-1 the loader silently defaults rather than throws.
    const cfg = loadClusterConfig();
    expect(cfg.defaultTags).toEqual(["ix-core"]);
    const incs = listIncidents().filter((i) => i.pluginId === "local");
    expect(incs.length).toBeGreaterThan(0);
    expect(incs[incs.length - 1].kind).toBe("schema");
  });
});

describe("loadConfig — domain.hosts", () => {
  beforeEach(() => {
    delete process.env.IX_INTERNAL_BASE_DOMAIN;
    delete process.env.IX_INTERNAL_BASE_DOMAINS;
  });

  it("defaults to a single-entry list of dev.ix when nothing is set", async () => {
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg.hosts).toEqual(["dev.ix"]);
    expect(cfg.internalBaseDomain).toBe("dev.ix");
  });

  it("reads multi-entry hosts from the persisted YAML", async () => {
    seedLocalYaml("domain:\n  hosts: [dev.ix, luna.ix, agent-ix.dev]\n");
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg.hosts).toEqual(["dev.ix", "luna.ix", "agent-ix.dev"]);
    expect(cfg.internalBaseDomain).toBe("dev.ix");
  });

  it("IX_INTERNAL_BASE_DOMAINS env var (plural) overrides file", async () => {
    seedLocalYaml("domain:\n  hosts: [dev.ix]\n");
    process.env.IX_INTERNAL_BASE_DOMAINS = "luna.ix, agent-ix.dev";
    try {
      const { loadConfig } = await import("../src/config.js");
      const cfg = loadConfig();
      expect(cfg.hosts).toEqual(["luna.ix", "agent-ix.dev"]);
    } finally {
      delete process.env.IX_INTERNAL_BASE_DOMAINS;
    }
  });

  it("legacy IX_INTERNAL_BASE_DOMAIN (singular) wins and pins to one entry", async () => {
    seedLocalYaml("domain:\n  hosts: [dev.ix, luna.ix]\n");
    process.env.IX_INTERNAL_BASE_DOMAIN = "ci.ix";
    try {
      const { loadConfig } = await import("../src/config.js");
      const cfg = loadConfig();
      expect(cfg.hosts).toEqual(["ci.ix"]);
      expect(cfg.internalBaseDomain).toBe("ci.ix");
    } finally {
      delete process.env.IX_INTERNAL_BASE_DOMAIN;
    }
  });

  it("rejects single-label entries", async () => {
    process.env.IX_INTERNAL_BASE_DOMAIN = "ix";
    try {
      const { loadConfig, ConfigValidationError } =
        await import("../src/config.js");
      expect(() => loadConfig()).toThrow(ConfigValidationError);
    } finally {
      delete process.env.IX_INTERNAL_BASE_DOMAIN;
    }
  });
});

describe("buildGlobalSetArgs — extraBaseDomains", () => {
  it("emits global.internalBaseDomain for hosts[0] only when single host", async () => {
    const { buildGlobalSetArgs } = await import("../src/config.js");
    const args = buildGlobalSetArgs({
      hosts: ["dev.ix"],
      internalBaseDomain: "dev.ix",
      externalBaseDomain: null,
      enableExternalHost: false,
      publicBaseUrl: null,
      imageRegistry: "ghcr.io/agent-ix",
    } as never);
    expect(args).toContain("global.internalBaseDomain=dev.ix");
    expect(
      args.find((a) => a.startsWith("global.extraBaseDomains")),
    ).toBeUndefined();
  });

  it("emits indexed global.extraBaseDomains for hosts[1:]", async () => {
    const { buildGlobalSetArgs } = await import("../src/config.js");
    const args = buildGlobalSetArgs({
      hosts: ["dev.ix", "luna.ix", "agent-ix.dev"],
      internalBaseDomain: "dev.ix",
      externalBaseDomain: null,
      enableExternalHost: false,
      publicBaseUrl: null,
      imageRegistry: "ghcr.io/agent-ix",
    } as never);
    expect(args).toContain("global.internalBaseDomain=dev.ix");
    expect(args).toContain("global.extraBaseDomains[0]=luna.ix");
    expect(args).toContain("global.extraBaseDomains[1]=agent-ix.dev");
  });
});

describe("computeEffectiveDeploySet", () => {
  const makeApp = (name: string, tags: string[]) => ({
    name,
    role: "app" as const,
    tags,
    version: "1.0.0",
    title: name,
    category: "test",
    entry: null,
  });

  const registry = [
    makeApp("ix-local-build", ["ix-core"]),
    makeApp("ix-local-data", ["ix-core"]),
    makeApp("ix-local-observability", ["observability"]),
    makeApp("other-app", []),
  ];

  const defaults = { defaultTags: ["ix-core"], extraApps: [], skipApps: [] };

  it("TC-025: ix-core tagged apps included by default", async () => {
    const { computeEffectiveDeploySet } =
      await import("../src/commands/cluster-up.js");
    const result = computeEffectiveDeploySet(registry, defaults);
    expect(result.map((d) => d.name)).toContain("ix-local-build");
    expect(result.map((d) => d.name)).toContain("ix-local-data");
  });

  it("TC-026: apps without ix-core tag excluded from default set", async () => {
    const { computeEffectiveDeploySet } =
      await import("../src/commands/cluster-up.js");
    const result = computeEffectiveDeploySet(registry, defaults);
    expect(result.map((d) => d.name)).not.toContain("ix-local-observability");
    expect(result.map((d) => d.name)).not.toContain("other-app");
  });

  it("TC-027: skipApps excludes even tagged app", async () => {
    const { computeEffectiveDeploySet } =
      await import("../src/commands/cluster-up.js");
    const cfg = { ...defaults, skipApps: ["ix-local-data"] };
    const result = computeEffectiveDeploySet(registry, cfg);
    expect(result.map((d) => d.name)).not.toContain("ix-local-data");
    expect(result.map((d) => d.name)).toContain("ix-local-build");
  });

  it("TC-028: extraApps includes untagged app", async () => {
    const { computeEffectiveDeploySet } =
      await import("../src/commands/cluster-up.js");
    const cfg = { ...defaults, extraApps: ["ix-local-observability"] };
    const result = computeEffectiveDeploySet(registry, cfg);
    expect(result.map((d) => d.name)).toContain("ix-local-observability");
  });

  it("TC-029: same app in tag-filter and extraApps appears exactly once", async () => {
    const { computeEffectiveDeploySet } =
      await import("../src/commands/cluster-up.js");
    const cfg = { ...defaults, extraApps: ["ix-local-build"] };
    const result = computeEffectiveDeploySet(registry, cfg);
    expect(result.filter((d) => d.name === "ix-local-build")).toHaveLength(1);
  });

  it("TC-030: skipApps takes precedence over extraApps", async () => {
    const { computeEffectiveDeploySet } =
      await import("../src/commands/cluster-up.js");
    const cfg = {
      ...defaults,
      extraApps: ["ix-local-observability"],
      skipApps: ["ix-local-observability"],
    };
    const result = computeEffectiveDeploySet(registry, cfg);
    expect(result.map((d) => d.name)).not.toContain("ix-local-observability");
  });

  it("TC-031: deterministic — same inputs produce same result", async () => {
    const { computeEffectiveDeploySet } =
      await import("../src/commands/cluster-up.js");
    const r1 = computeEffectiveDeploySet(registry, defaults).map((d) => d.name);
    const r2 = computeEffectiveDeploySet(registry, defaults).map((d) => d.name);
    expect(r1).toEqual(r2);
  });
});
