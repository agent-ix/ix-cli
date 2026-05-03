import { z } from "zod";

/**
 * `local` plugin's persistent configuration schema (FR-013, StR-005).
 *
 * Persisted at `~/.config/ix/config.d/local.yaml`. Only fields that
 * survive across `ix` invocations live here; ephemeral / env-only
 * settings (internal base domain, image registry, timeouts, etc.) are
 * resolved at runtime by `loadConfig()` in `config.ts` and are NOT
 * persisted.
 *
 * Schema is `.strict()` per FR-013-AC-2 — unknown keys are rejected at
 * write time. Nested objects each carry a default object literal so
 * `safeParse({})` returns a fully-populated object (FR-011-AC-1).
 */
export const LocalConfigSchema = z
  .object({
    cluster: z
      .object({
        defaultTags: z.array(z.string()).default(["ix-core"]),
        extraApps: z.array(z.string()).default([]),
        skipApps: z.array(z.string()).default([]),
      })
      .strict()
      .default({ defaultTags: ["ix-core"], extraApps: [], skipApps: [] }),
    concurrency: z
      .object({
        dockerPull: z.coerce.number().int().min(1).default(3),
        helmInstall: z.coerce.number().int().min(1).default(5),
        kubectlWatch: z.coerce.number().int().min(1).default(10),
      })
      .strict()
      .default({ dockerPull: 3, helmInstall: 5, kubectlWatch: 10 }),
  })
  .strict();

export type LocalConfig = z.infer<typeof LocalConfigSchema>;

/**
 * `local` plugin's secrets (FR-013-AC-6 envVar bindings + FR-014).
 *
 * `ghcr-token` resolves via env-var precedence (`IX_GHCR_TOKEN`,
 * `GITHUB_TOKEN`, `GH_TOKEN`, `GHCR_TOKEN`, `CR_PAT`) → SecretsService
 * backend → optional interactive prompt. Only `IX_GHCR_TOKEN` is the
 * canonical env binding; the legacy `GITHUB_TOKEN` family is honored
 * for compatibility with CI-style invocations and is consulted by the
 * `resolveGhcrToken` wrapper in `credentials.ts` when the canonical
 * env var is unset.
 */
export const LocalSecretsSchema = [
  {
    name: "ghcr-token",
    description: "GitHub Container Registry token (read:packages)",
    required: false,
    envVar: "IX_GHCR_TOKEN",
  },
] as const;

/**
 * Optional `IX_*` env-var bindings applied as the highest-precedence
 * layer over `~/.config/ix/config.d/local.yaml`. The legacy `IX_*`
 * timeout / version env vars are NOT in this map — they are read by
 * `loadConfig()` in `config.ts` directly because those values are
 * ephemeral overrides, not persistent config.
 */
export const LocalEnvBindings: Record<string, string> = {
  "concurrency.dockerPull": "IX_POOL_DOCKER_PULL",
  "concurrency.helmInstall": "IX_POOL_HELM_INSTALL",
  "concurrency.kubectlWatch": "IX_POOL_KUBECTL_WATCH",
};

export const LOCAL_PLUGIN_ID = "local" as const;
