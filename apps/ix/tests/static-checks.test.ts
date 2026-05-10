/**
 * TC-424: App packaging static checks.
 *
 * These protect the oclif command surface: a command file under src/commands
 * is not shippable unless apps/ix/vite.config.ts emits a matching dist entry.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

describe("workflow plugin contract integration", () => {
  it("registers the workflow plugin manifest during app init", () => {
    const src = readFileSync(join(SRC_ROOT, "hooks/init.ts"), "utf-8");
    expect(src).toMatch(/import\s+\{\s*workflowIxPlugin\s*\}/);
    expect(src).toContain("registerIxPlugin(workflowIxPlugin)");
  });

  it("resolves workflow command config through ConfigService", () => {
    const src = readFileSync(join(SRC_ROOT, "workflow.ts"), "utf-8");
    expect(src).toContain("ConfigService.forPlugin");
    expect(src).toContain("WORKFLOW_PLUGIN_ID");
    expect(src).toContain("WorkflowPluginEnvBindings");
  });
});
