/**
 * Init-hook coverage for workflow-plugin discovery (FR-010-AC-1/AC-3).
 *
 * Drives `src/hooks/init.ts` directly with a synthetic oclif `config`
 * object so we can assert what gets registered without booting the
 * whole CLI. Covers:
 *
 *   - happy path: a plugin exporting `{ ixSchema, workflowPlugin }` is
 *     accepted; the contribution is visible in `getRegisteredWorkflowPlugins`.
 *   - FR-010-AC-3: a plugin exporting `workflowPlugin` WITHOUT `ixSchema`
 *     is warn-and-skipped (workflow does not appear in the registry).
 *   - FR-010 / warn-and-skip: a plugin whose `load()` rejects is
 *     warn-and-skipped; other plugins still register.
 *   - workflow_name_conflict: a duplicate `def.name` across two plugins
 *     surfaces as a warning from the hook (init continues).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWorkflowDef, type WorkflowPlugin } from "@agent-ix/workflow-core";
import {
  clearRegisteredWorkflowPlugins,
  getRegisteredWorkflowPlugins,
} from "@agent-ix/workflow-cli-plugin";

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

const helloDef = parseWorkflowDef({
  name: "hello-init",
  version: "0.1.0",
  initialPhase: "start",
  phases: [{ name: "start" }, { name: "done", terminal: true }],
  transitions: [
    { from: "start", to: "done", invariants: [], defaultGate: "auto" },
  ],
  itemSchemas: {},
  linkSchemas: {},
});

const helloPlugin: WorkflowPlugin = {
  workflows: [{ def: helloDef, invariants: {} }],
};

const ixSchemaStub = { id: "init-hook-test" };

async function runHook(plugins: FakePlugin[]): Promise<HookContext> {
  _resetInitGuardForTests();
  clearRegisteredWorkflowPlugins();
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
  clearRegisteredWorkflowPlugins();
});

afterEach(() => {
  _resetInitGuardForTests();
  clearRegisteredWorkflowPlugins();
});

describe("init hook — workflowPlugin discovery (FR-010)", () => {
  it("registers a workflowPlugin contribution when ixSchema is also present (FR-010-AC-1)", async () => {
    const ctx = await runHook([
      {
        name: "@test/good-plugin",
        load: async () => ({
          ixSchema: ixSchemaStub,
          workflowPlugin: helloPlugin,
        }),
      },
    ]);

    const registered = getRegisteredWorkflowPlugins();
    expect(registered).toHaveLength(1);
    expect(registered[0].source).toBe("@test/good-plugin");
    expect(registered[0].plugin.workflows[0].def.name).toBe("hello-init");
    // No warning about this plugin.
    expect(ctx.warnings.filter((w) => w.includes("@test/good-plugin"))).toEqual(
      [],
    );
  });

  it("rejects workflowPlugin without ixSchema with a warning (FR-010-AC-3)", async () => {
    const ctx = await runHook([
      {
        name: "@test/missing-ix-schema",
        load: async () => ({ workflowPlugin: helloPlugin }),
      },
    ]);

    expect(getRegisteredWorkflowPlugins()).toHaveLength(0);
    expect(
      ctx.warnings.some(
        (w) =>
          w.includes("@test/missing-ix-schema") && w.includes("FR-010-AC-3"),
      ),
    ).toBe(true);
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
        name: "@test/good-plugin",
        load: async () => ({
          ixSchema: ixSchemaStub,
          workflowPlugin: helloPlugin,
        }),
      },
    ]);

    const registered = getRegisteredWorkflowPlugins();
    expect(registered).toHaveLength(1);
    expect(registered[0].source).toBe("@test/good-plugin");
    expect(
      ctx.warnings.some(
        (w) => w.includes("@test/broken-plugin") && w.includes("kaboom"),
      ),
    ).toBe(true);
  });

  it("warns when two plugins contribute the same workflow name (FR-010 errors)", async () => {
    const ctx = await runHook([
      {
        name: "@test/first",
        load: async () => ({
          ixSchema: ixSchemaStub,
          workflowPlugin: helloPlugin,
        }),
      },
      {
        name: "@test/second",
        load: async () => ({
          ixSchema: ixSchemaStub,
          workflowPlugin: helloPlugin,
        }),
      },
    ]);

    // The first plugin registers; the second's duplicate name triggers
    // a warning from `registerWorkflowPlugin` -> hook.warn path. We
    // accept either order of register/skip — the contract is that the
    // hook does not abort and at least one is registered.
    const registered = getRegisteredWorkflowPlugins();
    expect(registered.length).toBeGreaterThanOrEqual(1);
    expect(
      ctx.warnings.some(
        (w) =>
          (w.includes("@test/second") || w.includes("@test/first")) &&
          /workflowPlugin registration failed|workflow_name_conflict|hello-init/.test(
            w,
          ),
      ),
    ).toBe(true);
  });

  it("ignores plugins exporting neither ixSchema nor workflowPlugin", async () => {
    const ctx = await runHook([
      {
        name: "@test/inert-plugin",
        load: async () => ({}),
      },
    ]);

    expect(getRegisteredWorkflowPlugins()).toHaveLength(0);
    expect(
      ctx.warnings.filter((w) => w.includes("@test/inert-plugin")),
    ).toEqual([]);
  });
});
