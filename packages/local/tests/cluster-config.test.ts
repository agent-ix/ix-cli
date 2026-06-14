/**
 * TC-022–TC-031: loadClusterConfig() and computeEffectiveDeploySet()
 *   FR-009 (cluster defaults), FR-005 (deploy set algorithm).
 * TC-032–TC-040: loadConfig() + buildGlobalSetArgs()
 *   FR-037 (multi-host ingress config).
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
    await import("@agent-ix/ix-cli-core");
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

/**
 * TC-032..TC-038: FR-037 Multi-Host Ingress Config.
 * Each test docstring carries `Trace: FR-037-AC-N` so spec-to-test
 * mapping is greppable.
 */
describe("loadConfig — domain.hosts (FR-037)", () => {
  beforeEach(() => {
    delete process.env.IX_INTERNAL_BASE_DOMAIN;
    delete process.env.IX_INTERNAL_BASE_DOMAINS;
    delete process.env.IX_ENABLE_EXTERNAL_HOST;
    delete process.env.IX_EXTERNAL_BASE_DOMAIN;
  });

  it("TC-032: defaults to single-entry [dev.ix] (Trace: FR-037-AC-1)", async () => {
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg.hosts).toEqual(["dev.ix"]);
    expect(cfg.internalBaseDomain).toBe("dev.ix");
  });

  it("TC-033: reads multi-entry hosts from persisted YAML (Trace: FR-037-AC-2)", async () => {
    seedLocalYaml("domain:\n  hosts: [dev.ix, luna.ix, agent-ix.dev]\n");
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg.hosts).toEqual(["dev.ix", "luna.ix", "agent-ix.dev"]);
    expect(cfg.internalBaseDomain).toBe("dev.ix");
  });

  it("TC-034: IX_INTERNAL_BASE_DOMAINS (plural) overrides file (Trace: FR-037-AC-3)", async () => {
    seedLocalYaml("domain:\n  hosts: [dev.ix]\n");
    process.env.IX_INTERNAL_BASE_DOMAINS = "luna.ix, agent-ix.dev";
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg.hosts).toEqual(["luna.ix", "agent-ix.dev"]);
  });

  it("TC-035: legacy IX_INTERNAL_BASE_DOMAIN (singular) wins over plural + file (Trace: FR-037-AC-4)", async () => {
    seedLocalYaml("domain:\n  hosts: [dev.ix, luna.ix]\n");
    process.env.IX_INTERNAL_BASE_DOMAINS = "should-be-ignored.ix";
    process.env.IX_INTERNAL_BASE_DOMAIN = "ci.ix";
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg.hosts).toEqual(["ci.ix"]);
    expect(cfg.internalBaseDomain).toBe("ci.ix");
  });

  it("TC-036: rejects single-label entries at load time (Trace: FR-037-AC-5)", async () => {
    process.env.IX_INTERNAL_BASE_DOMAIN = "ix";
    const { loadConfig, ConfigValidationError } =
      await import("../src/config.js");
    expect(() => loadConfig()).toThrow(ConfigValidationError);
  });

  it("TC-037: rejects single-label entries at write time via schema (Trace: FR-037-AC-5, US-010-AC-5)", async () => {
    const { LocalConfigSchema } = await import("../src/schema.js");
    const result = LocalConfigSchema.safeParse({
      domain: { hosts: ["ix"] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("\n");
      expect(msg).toMatch(/hosts/);
      expect(msg).toMatch(/at least two labels/);
    }
  });

  it("TC-038: enableExternal=true without external throws (Trace: FR-037-CON-3)", async () => {
    process.env.IX_ENABLE_EXTERNAL_HOST = "true";
    // Deliberately leave IX_EXTERNAL_BASE_DOMAIN unset.
    const { loadConfig, ConfigValidationError } =
      await import("../src/config.js");
    expect(() => loadConfig()).toThrow(ConfigValidationError);
  });
});

describe("buildGlobalSetArgs — extraBaseDomains (FR-037)", () => {
  it("TC-039: single host → no extraBaseDomains flag (Trace: FR-037-AC-6)", async () => {
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

  it("TC-040: multi-host → indexed extraBaseDomains for hosts[1:] (Trace: FR-037-AC-6)", async () => {
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

describe("buildTunnelSetArgs — per-app expose intent (FR-038)", () => {
  const baseTunnel = {
    autoStart: false,
    baseDomain: "agent-ix.dev",
    tunnelId: null,
  };

  it("TC-041: returns [] when release is not in tunnel.exposed", async () => {
    const { buildTunnelSetArgs } = await import("../src/config.js");
    const args = buildTunnelSetArgs(
      { ...baseTunnel, exposed: {} },
      "cloud-manager-ui",
      null,
    );
    expect(args).toEqual([]);
  });

  it("TC-042: single-service release (entryKey=null) targets ix-service subchart", async () => {
    const { buildTunnelSetArgs } = await import("../src/config.js");
    const args = buildTunnelSetArgs(
      {
        ...baseTunnel,
        exposed: { "spec-editor": { hostname: null } },
      },
      "spec-editor",
      null,
    );
    expect(args).toContain("global.tunnelBaseDomains[0]=agent-ix.dev");
    // Toggle MUST land on `ix-service.ingress.<key>`, not the wrapper
    // chart's bare `ingress.<key>` — wrapper-chart values aren't read
    // by ix-service, so a bare-path toggle is a silent no-op.
    expect(args).toContain("ix-service.ingress.exposeOnTunnel=true");
    expect(args).not.toContain("ingress.exposeOnTunnel=true");
    expect(
      args.find((a) => a.startsWith("ix-service.ingress.extraHosts")),
    ).toBeUndefined();
  });

  it("TC-043: umbrella release prefixes <entry>.ix-service", async () => {
    const { buildTunnelSetArgs } = await import("../src/config.js");
    const args = buildTunnelSetArgs(
      {
        ...baseTunnel,
        exposed: { "cloud-manager-app": { hostname: null } },
      },
      "cloud-manager-app",
      "cloud-manager-ui",
    );
    expect(args).toContain(
      "cloud-manager-ui.ix-service.ingress.exposeOnTunnel=true",
    );
    // Wrapper-level toggle MUST NOT be set — silent no-op that would
    // mask the actual gate.
    expect(args).not.toContain("cloud-manager-ui.ingress.exposeOnTunnel=true");
    expect(args).not.toContain("ix-service.ingress.exposeOnTunnel=true");
  });

  it("TC-044: hostname override appends to entry's ix-service.ingress.extraHosts[0]", async () => {
    const { buildTunnelSetArgs } = await import("../src/config.js");
    const args = buildTunnelSetArgs(
      {
        ...baseTunnel,
        exposed: {
          "cloud-manager-app": { hostname: "vanity.agent-ix.dev" },
        },
      },
      "cloud-manager-app",
      "cloud-manager-ui",
    );
    expect(args).toContain(
      "cloud-manager-ui.ix-service.ingress.extraHosts[0]=vanity.agent-ix.dev",
    );
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
