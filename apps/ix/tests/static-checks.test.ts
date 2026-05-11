/**
 * TC-500..TC-510 (revised): App packaging static checks.
 *
 * Protects the oclif-native plugin architecture introduced in task-06:
 * - Every src/commands file has a matching Vite build entry.
 * - bin/ix.js does NOT preprocess argv (FR-022 revised).
 * - The init hook walks Config.plugins for ixSchema (FR-025 revised),
 *   not a custom IxPlugin registry.
 * - apps/ix/package.json lists @agent-ix/workflow-cli-plugin in
 *   oclif.plugins instead of registering it through the legacy
 *   distribution module.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const APP_ROOT = new URL("..", import.meta.url).pathname;
const SRC_ROOT = join(APP_ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return [full];
  });
}

describe("oclif command packaging", () => {
  it("every src/commands file has a Vite build entry", () => {
    const viteConfig = readFileSync(join(APP_ROOT, "vite.config.ts"), "utf-8");
    const commandFiles = walk(join(SRC_ROOT, "commands")).filter((file) =>
      /\.(ts|tsx)$/.test(file),
    );

    for (const file of commandFiles) {
      const srcPath = relative(APP_ROOT, file);
      const entryName = relative(SRC_ROOT, file).replace(/\.(ts|tsx)$/, "");
      expect(viteConfig, `${srcPath} must be emitted as ${entryName}`).toMatch(
        new RegExp(
          `"${entryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"${srcPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        ),
      );
    }
  });
});

describe("local up tunnel exposure", () => {
  it("source-mode up does not run tunnel exposure", () => {
    const src = readFileSync(join(SRC_ROOT, "commands/local/up.ts"), "utf-8");
    expect(src).toMatch(
      /const\s+fromSource\s*=\s*flags\["from-source"\]\s*\|\|\s*flags\.src/,
    );
    expect(src).toMatch(/if\s*\(\s*flags\.expose\s*&&\s*!fromSource\s*\)/);
  });
});

describe("oclif-native plugin architecture (FR-021/022/025 revised)", () => {
  it("workflow commands live in the workflow-cli-plugin, not apps/ix", () => {
    expect(existsSync(join(SRC_ROOT, "commands/workflow"))).toBe(false);
    expect(existsSync(join(SRC_ROOT, "workflow.ts"))).toBe(false);
  });

  it("apps/ix/package.json lists workflow-cli-plugin in oclif.plugins", () => {
    const pkg = JSON.parse(
      readFileSync(join(APP_ROOT, "package.json"), "utf-8"),
    );
    expect(pkg.oclif.plugins).toContain("@agent-ix/workflow-cli-plugin");
  });

  it("bin/ix.js does NOT preprocess argv for --config-root", () => {
    const src = readFileSync(join(APP_ROOT, "bin/ix.js"), "utf-8");
    expect(src).not.toContain("IX_RUNTIME_CONFIG_ROOT_FLAG");
    expect(src).not.toContain("IX_RUNTIME_NO_PROJECT_CONFIG");
    expect(src).not.toContain('arg === "--config-root"');
    // The bin script is the minimal oclif boot.
    expect(src).toContain("import { execute } from");
    expect(src).toContain("@oclif/core");
  });

  it("init hook walks Config.plugins for ixSchema, not a custom registry", () => {
    const src = readFileSync(join(SRC_ROOT, "hooks/init.ts"), "utf-8");
    expect(src).toContain("registerPluginSchema");
    expect(src).toContain("config.plugins");
    expect(src).toContain("ixSchema");
    // Legacy custom-plugin layer is gone.
    expect(src).not.toContain("configureDistributionRuntime");
    expect(src).not.toContain("registerIxPlugin(plugin)");
    expect(src).not.toContain("ixDistribution.defaultPlugins");
    expect(src).not.toContain("Command.baseFlags = ");
  });

  it("the legacy distribution.ts has been removed", () => {
    expect(existsSync(join(SRC_ROOT, "distribution.ts"))).toBe(false);
  });
});
