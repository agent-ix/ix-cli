import { Hook } from "@oclif/core";

import {
  AgeFileBackend,
  ConfigService,
  KeyringBackend,
  registerIxPlugin,
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
import { workflowIxPlugin } from "@agent-ix/workflow-cli-plugin";

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

  // ── plugin contract registration ───────────────────────────────────
  try {
    const coreReg = registerIxPlugin({
      id: CORE_ID,
      configSchema: CoreConfigSchema,
      envBindings: CoreEnvBindings,
      secretsSchema: CoreSecretsSchema,
    });
    if (!coreReg.ok) {
      // Should never happen in production (one init hook per process).
      // Surface but don't crash.
      this.warn(
        `core plugin registration failed: ${coreReg.kind} — ${coreReg.detail}`,
      );
    }
  } catch (err) {
    this.warn(
      `core plugin init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const localReg = registerIxPlugin({
      id: LOCAL_PLUGIN_ID,
      configSchema: LocalConfigSchema,
      envBindings: LocalEnvBindings,
      secretsSchema: [...LocalSecretsSchema],
    });
    if (!localReg.ok) {
      this.warn(
        `local plugin registration failed: ${localReg.kind} — ${localReg.detail}`,
      );
    }
  } catch (err) {
    this.warn(
      `local plugin init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const workflowReg = registerIxPlugin(workflowIxPlugin);
    if (!workflowReg.ok) {
      this.warn(
        `workflow plugin registration failed: ${workflowReg.kind} — ${workflowReg.detail}`,
      );
    }
  } catch (err) {
    this.warn(
      `workflow plugin init failed: ${err instanceof Error ? err.message : String(err)}`,
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
