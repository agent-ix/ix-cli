import {
  AgeFileBackend,
  ConfigService,
  IxPluginSchema,
  KeyringBackend,
  registerPlugin,
  registerPluginSchema,
  registerSecretsForPlugin,
  setDefaultSecretsService,
  SecretsService,
  type SecretsBackend,
  type SecretsBackendMode,
} from "@agent-ix/ix-cli-core";
import { registerWorkflowPlugin } from "@agent-ix/workflow-cli-plugin";
import type { WorkflowPlugin } from "@agent-ix/workflow-core";
import {
  LocalConfigSchema,
  LocalEnvBindings,
  LocalSecretsSchema,
  LOCAL_PLUGIN_ID,
} from "@agent-ix/ix-cli-local";
import { Hook } from "@oclif/core";

import {
  CORE_ID,
  CoreConfigSchema,
  CoreEnvBindings,
  CoreSecretsSchema,
} from "../core-plugin.js";

let registered = false;

/**
 * oclif `init` hook — runs once before any command. Registers built-in
 * plugin schemas through `ConfigService` / `SecretsService`, walks every
 * oclif-loaded plugin for its optional `ixSchema` named export and
 * registers those too (FR-025 revised), then installs the
 * process-global `SecretsService` configured per `core.secretsBackend`.
 *
 * Idempotent: re-running the hook in tests / oclif sub-invocations is a
 * no-op via the `registered` guard plus the registry's first-wins
 * semantics.
 */
const hook: Hook<"init"> = async function ({ config }) {
  if (registered) return;
  registered = true;

  // ── Built-in plugins from this binary (core, local) ─────────────────
  try {
    registerPlugin({
      pluginId: CORE_ID,
      schema: CoreConfigSchema,
      envBindings: CoreEnvBindings,
    });
    registerSecretsForPlugin(CORE_ID, CoreSecretsSchema);
  } catch (err) {
    this.warn(
      `core plugin init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    registerPlugin({
      pluginId: LOCAL_PLUGIN_ID,
      schema: LocalConfigSchema,
      envBindings: LocalEnvBindings,
    });
    registerSecretsForPlugin(LOCAL_PLUGIN_ID, [...LocalSecretsSchema]);
  } catch (err) {
    this.warn(
      `${LOCAL_PLUGIN_ID} plugin init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── ixSchema convention (FR-025 revised) ───────────────────────────
  // Walk every oclif-loaded plugin and register its optional ixSchema
  // export with the shared schema registry. The install/load identity is
  // the npm package name; ixSchema.id, when present, is the config and
  // secrets namespace.
  for (const plugin of config.plugins.values()) {
    if (plugin.name === "@agent-ix/ix") continue; // self
    try {
      const mod = await loadPluginMain(plugin);
      const ixSchema = (mod as { ixSchema?: IxPluginSchema }).ixSchema;
      if (ixSchema) {
        const result = registerPluginSchema(plugin.name, ixSchema);
        if (!result.ok) {
          this.warn(
            `${plugin.name} schema registration failed: ${result.kind} — ${result.detail}`,
          );
        }
      }

      // FR-010: also collect `workflowPlugin` exports into the
      // workflow-cli-plugin process-scope registry.
      const workflowPlugin = (mod as { workflowPlugin?: WorkflowPlugin })
        .workflowPlugin;
      if (workflowPlugin) {
        try {
          registerWorkflowPlugin(plugin.name, workflowPlugin);
        } catch (err) {
          this.warn(
            `${plugin.name} workflowPlugin registration failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.warn(
        `${plugin.name} plugin init failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── SecretsService default ─────────────────────────────────────────
  let mode: SecretsBackendMode = "auto";
  try {
    mode = ConfigService.forPlugin(CORE_ID, CoreConfigSchema, {
      envBindings: CoreEnvBindings,
    }).get().secretsBackend;
  } catch (err) {
    this.warn(
      `failed to read core.secretsBackend (defaulting to "auto"): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  setDefaultSecretsService(
    new SecretsService({
      mode,
      backends: new Map<string, SecretsBackend>([
        ["keyring", new KeyringBackend()],
        ["age-file", new AgeFileBackend()],
      ]),
    }),
  );
};

/** Test-only escape hatch: forget that the hook ran so the next
 * invocation re-registers. Not exported from the package. */
export function _resetInitGuardForTests(): void {
  registered = false;
}

async function loadPluginMain(plugin: {
  load?: () => Promise<unknown>;
  name: string;
}): Promise<unknown> {
  const loaded = (await plugin.load?.()) ?? {};
  if (hasIxExports(loaded)) return loaded;

  try {
    const imported = (await import(plugin.name)) as unknown;
    if (hasIxExports(imported)) return imported;
  } catch {
    // Some oclif plugins do not expose importable package mains. Those
    // remain valid plugins; they simply have no IX config/secrets schema
    // or workflow contributions.
  }

  return loaded;
}

function hasIxExports(
  value: unknown,
): value is { ixSchema?: IxPluginSchema; workflowPlugin?: WorkflowPlugin } {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as {
    ixSchema?: IxPluginSchema;
    workflowPlugin?: WorkflowPlugin;
  };
  return Boolean(obj.ixSchema) || Boolean(obj.workflowPlugin);
}

export default hook;
