/**
 * Init-hook coverage for the ixSchema plugin walk (FR-025 revised).
 *
 * Drives `src/hooks/init.ts` directly with a synthetic oclif `config`
 * object so we can assert how the plugin walk behaves without booting the
 * whole CLI. Workflow discovery was removed from ix-cli (moved to ix-flow),
 * so this only exercises the schema-registration walk:
 *
 *   - a plugin exporting `ixSchema` is accepted without warnings.
 *   - a plugin whose `load()` rejects is warn-and-skipped; other plugins
 *     still process.
 *   - a plugin exporting neither `ixSchema` is ignored silently.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import hook, { _resetInitGuardForTests } from "../src/hooks/init.js";

interface FakePlugin {
  name: string;
  load: () => Promise<unknown>;
}

function fakeConfig(plugins: FakePlugin[]): {
  plugins: { values(): IterableIterator<FakePlugin> };
} {
  return {
    plugins: { values: () => plugins.values() },
  };
}

interface HookContext {
  warn: (message: string) => void;
  warnings: string[];
}

function hookContext(): HookContext {
  const warnings: string[] = [];
  return {
    warnings,
    warn(message: string) {
      warnings.push(message);
    },
  };
}

async function runHook(plugins: FakePlugin[]): Promise<HookContext> {
  _resetInitGuardForTests();
  const ctx = hookContext();
  // The hook narrows `this` to oclif's Hook context; the only member it
  // touches on `this` is `warn`, so a bare object is sufficient.
  await (
    hook as unknown as (
      this: HookContext,
      opts: { config: unknown },
    ) => Promise<void>
  ).call(ctx, { config: fakeConfig(plugins) });
  return ctx;
}

beforeEach(() => {
  _resetInitGuardForTests();
});

afterEach(() => {
  _resetInitGuardForTests();
});

describe("init hook — ixSchema plugin walk (FR-025)", () => {
  // NOTE: the plugin-schema registry is process-global and not reset between
  // tests, so each test uses a unique plugin name to avoid spurious
  // duplicate-registration warnings.
  it("accepts a plugin exporting ixSchema without warnings", async () => {
    const ctx = await runHook([
      {
        name: "@test/ix-schema-ok",
        load: async () => ({ ixSchema: { id: "init-hook-ok" } }),
      },
    ]);

    expect(
      ctx.warnings.filter((w) => w.includes("@test/ix-schema-ok")),
    ).toEqual([]);
  });

  it("warn-and-skips a plugin whose load() throws and continues with the rest", async () => {
    const ctx = await runHook([
      {
        name: "@test/broken-plugin",
        load: async () => {
          throw new Error("kaboom: module failed to import");
        },
      },
      {
        name: "@test/good-after-broken",
        load: async () => ({ ixSchema: { id: "init-hook-after-broken" } }),
      },
    ]);

    expect(
      ctx.warnings.some(
        (w) => w.includes("@test/broken-plugin") && w.includes("kaboom"),
      ),
    ).toBe(true);
    // The good plugin after the broken one still processed without warning.
    expect(
      ctx.warnings.filter((w) => w.includes("@test/good-after-broken")),
    ).toEqual([]);
  });

  it("ignores plugins exporting neither ixSchema", async () => {
    const ctx = await runHook([
      {
        name: "@test/inert-plugin",
        load: async () => ({}),
      },
    ]);

    expect(
      ctx.warnings.filter((w) => w.includes("@test/inert-plugin")),
    ).toEqual([]);
  });
});
