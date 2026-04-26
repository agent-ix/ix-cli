/**
 * TC-022–TC-031: loadClusterConfig() and computeEffectiveDeploySet()
 * FR-009, FR-005 (deploy set algorithm)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Mock fs and path so loadClusterConfig reads our fixture
const CONFIG_PATH = path.join(os.homedir(), ".ix", "config.yaml");

describe("loadClusterConfig", () => {
  let originalExists: typeof fs.existsSync;
  let originalReadFile: typeof fs.readFileSync;

  beforeEach(() => {
    originalExists = fs.existsSync;
    originalReadFile = fs.readFileSync;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (fs as unknown as Record<string, unknown>).existsSync = originalExists;
    (fs as unknown as Record<string, unknown>).readFileSync = originalReadFile;
  });

  it("TC-022: missing config file returns defaults { defaultTags: ['ix-core'], extraApps: [], skipApps: [] }", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const { loadClusterConfig } = await import("../src/config.js");
    const cfg = loadClusterConfig();
    expect(cfg).toEqual({
      defaultTags: ["ix-core"],
      extraApps: [],
      skipApps: [],
    });
  });

  it("TC-023: config with cluster key parsed correctly", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) =>
      p === CONFIG_PATH
        ? true
        : (originalExists as typeof fs.existsSync)(p as string),
    );
    vi.spyOn(fs, "readFileSync").mockImplementation((p, enc) => {
      if (p === CONFIG_PATH)
        return "cluster:\n  defaultTags: [ix-core, extra]\n  extraApps: [myapp]\n  skipApps: [skipme]\n";
      return (originalReadFile as typeof fs.readFileSync)(
        p as string,
        enc as BufferEncoding,
      );
    });
    const { loadClusterConfig } = await import("../src/config.js");
    const cfg = loadClusterConfig();
    expect(cfg.defaultTags).toEqual(["ix-core", "extra"]);
    expect(cfg.extraApps).toEqual(["myapp"]);
    expect(cfg.skipApps).toEqual(["skipme"]);
  });

  it("TC-024: non-array value for defaultTags throws ConfigValidationError", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) =>
      p === CONFIG_PATH
        ? true
        : (originalExists as typeof fs.existsSync)(p as string),
    );
    vi.spyOn(fs, "readFileSync").mockImplementation((p, enc) => {
      if (p === CONFIG_PATH) return "cluster:\n  defaultTags: not-an-array\n";
      return (originalReadFile as typeof fs.readFileSync)(
        p as string,
        enc as BufferEncoding,
      );
    });
    const { loadClusterConfig, ConfigValidationError } =
      await import("../src/config.js");
    expect(() => loadClusterConfig()).toThrow(ConfigValidationError);
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
