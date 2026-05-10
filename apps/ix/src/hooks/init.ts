import { Command, Flags, Hook } from "@oclif/core";

import {
  AgeFileBackend,
  ConfigService,
  KeyringBackend,
  configureDistributionRuntime,
  registerIxPlugin,
  setDefaultSecretsService,
  SecretsService,
  type SecretsBackend,
  type SecretsBackendMode,
} from "@agent-ix/ix-cli-core";
import { CORE_ID, CoreConfigSchema, CoreEnvBindings } from "../core-plugin.js";
import { ixDistribution } from "../distribution.js";

let registered = false;

const runtimeBaseFlags = {
  "config-root": Flags.string({
    description: "Override the user-level ix config root.",
    helpGroup: "GLOBAL",
  }),
  "no-project-config": Flags.boolean({
    description: "Disable project-local .ix config layering.",
    default: false,
    helpGroup: "GLOBAL",
  }),
};

/**
 * oclif `init` hook — runs once before any command. Registers the
 * built-in plugins (`core`, `local`) with the shared schema +
 * secrets registries, then installs the process-global
 * `SecretsService` configured per `core.secretsBackend` (FR-020-AC-3).
 *
 * Registration is idempotent: re-running the hook in tests / oclif
 * sub-invocations is a no-op via the `registered` guard plus the
 * registry's first-wins semantics.
 *
 * Per FR-013 init-failure isolation, registration errors are logged
 * and swallowed — a misbehaving plugin never crashes the CLI on
 * startup.
 */
const hook: Hook<"init"> = async function () {
  if (registered) return;
  registered = true;

  Command.baseFlags = {
    ...Command.baseFlags,
    ...runtimeBaseFlags,
  };

  configureDistributionRuntime({
    distribution: ixDistribution,
    argv: runtimeArgv(),
    env: process.env,
    noProjectConfig:
      process.env.IX_RUNTIME_NO_PROJECT_CONFIG === "1" ||
      process.argv.includes("--no-project-config"),
  });

  // ── plugin contract registration ───────────────────────────────────
  for (const plugin of ixDistribution.defaultPlugins) {
    try {
      const result = registerIxPlugin(plugin);
      if (!result.ok) {
        this.warn(
          `${plugin.id} plugin registration failed: ${result.kind} — ${result.detail}`,
        );
      }
    } catch (err) {
      this.warn(
        `${plugin.id} plugin init failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── SecretsService default ─────────────────────────────────────────
  // Read the configured backend from the `core` plugin's config
  // (FR-020-AC-3). If the file is absent / malformed the schema's
  // default ("auto") applies via FR-011-AC-1 soft-defaulting.
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

  const svc = new SecretsService({
    mode,
    backends: new Map<string, SecretsBackend>([
      ["keyring", new KeyringBackend()],
      ["age-file", new AgeFileBackend()],
    ]),
  });
  setDefaultSecretsService(svc);
};

/** Test-only escape hatch: forget that the hook ran so the next
 * invocation re-registers. Not exported from the package. */
export function _resetInitGuardForTests(): void {
  registered = false;
}

export default hook;

function runtimeArgv(): string[] {
  const flagRoot = process.env.IX_RUNTIME_CONFIG_ROOT_FLAG;
  if (!flagRoot) return process.argv.slice(2);
  return [`--config-root=${flagRoot}`, ...process.argv.slice(2)];
}
