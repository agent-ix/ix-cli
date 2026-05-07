import { Hook } from "@oclif/core";

import {
  AgeFileBackend,
  ConfigService,
  KeyringBackend,
  registerPlugin,
  registerSecretsForPlugin,
  setDefaultSecretsService,
  SecretsService,
  type SecretsBackend,
  type SecretsBackendMode,
} from "@agent-ix/ix-cli-core";
import {
  LocalConfigSchema,
  LocalEnvBindings,
  LocalSecretsSchema,
  LOCAL_PLUGIN_ID,
} from "@agent-ix/ix-cli-local";

import {
  CORE_ID,
  CoreConfigSchema,
  CoreEnvBindings,
  CoreSecretsSchema,
} from "../core-plugin.js";

let registered = false;

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

  // ── core ────────────────────────────────────────────────────────────
  try {
    const coreReg = registerPlugin({
      pluginId: CORE_ID,
      schema: CoreConfigSchema,
      envBindings: CoreEnvBindings,
    });
    if (!coreReg.ok) {
      // Should never happen in production (one init hook per process).
      // Surface but don't crash.
      this.warn(
        `core plugin registration failed: ${coreReg.kind} — ${coreReg.attempted.pluginId}`,
      );
    }
    for (const result of registerSecretsForPlugin(CORE_ID, CoreSecretsSchema)) {
      if (!result.ok) {
        this.warn(
          `core secret registration failed: ${result.kind} — ${result.attempted.id}`,
        );
      }
    }
  } catch (err) {
    this.warn(
      `core plugin init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── local ───────────────────────────────────────────────────────────
  try {
    const localReg = registerPlugin({
      pluginId: LOCAL_PLUGIN_ID,
      schema: LocalConfigSchema,
      envBindings: LocalEnvBindings,
    });
    if (!localReg.ok) {
      this.warn(
        `local plugin registration failed: ${localReg.kind} — ${localReg.attempted.pluginId}`,
      );
    }
    for (const result of registerSecretsForPlugin(LOCAL_PLUGIN_ID, [
      ...LocalSecretsSchema,
    ])) {
      if (!result.ok) {
        this.warn(
          `local secret registration failed: ${result.kind} — ${result.attempted.id}`,
        );
      }
    }
  } catch (err) {
    this.warn(
      `local plugin init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
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
