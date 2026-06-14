import { z } from "zod";

import { CORE_PLUGIN_ID, type SecretDeclaration } from "@agent-ix/ix-cli-core";

/**
 * FR-020 — `core` plugin's `configSchema`. Persisted at
 * `~/.config/ix/config.yaml` (the file-layout carve-out for `core`).
 *
 * Strict schema, fully-defaulted leaves: every key returns a usable
 * value from `forPlugin('core', CoreConfigSchema).get()` with no file
 * present and no env vars set (FR-020-AC-1).
 */
export const CoreConfigSchema = z
  .object({
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    secretsBackend: z.enum(["auto", "keyring", "age-file"]).default("auto"),
    auth: z
      .object({
        serviceUrl: z.url().default("https://auth.ix"),
        // Written by `ix login`, read by token-refresh logic. Optional
        // (unset until first login).
        expiresAt: z.iso.datetime().optional(),
        // Per-host token metadata written by `ix login <host>` and read by
        // the ix-cli-core TokenStore (FR-019). Keyed by the slugified host.
        // Token VALUES never live here — only the SecretsService holds those
        // (ix://agent-ix/ix-cli-core/NFR-006). Map keys are host slugs; the
        // schema is permissive on the key set, strict on the value shape.
        hosts: z
          .record(
            z.string(),
            z
              .object({
                // Unix epoch milliseconds at which the stored access token
                // expires.
                expiresAt: z.number(),
                audience: z.string().optional(),
                scope: z.string().optional(),
                // Original normalized host (e.g. `filament.dev.ix`) for
                // human-readable `whoami` / `logout` output. The map KEY is
                // the hash-discriminated storage slug; this is the friendly
                // host. Never a token value (NFR-006).
                host: z.string().optional(),
              })
              .strict(),
          )
          .default({}),
      })
      .strict()
      .default({ serviceUrl: "https://auth.ix", hosts: {} }),
    telemetry: z
      .object({
        enabled: z.coerce.boolean().default(false),
      })
      .strict()
      .default({ enabled: false }),
    theme: z.enum(["auto", "light", "dark"]).default("auto"),
    updateCheck: z
      .object({
        enabled: z.coerce.boolean().default(true),
        intervalHours: z.coerce.number().int().min(1).max(168).default(24),
      })
      .strict()
      .default({ enabled: true, intervalHours: 24 }),
  })
  .strict();

export type CoreConfig = z.infer<typeof CoreConfigSchema>;

/**
 * FR-020 — env-var bindings for the `core` plugin. Each leaf maps to
 * a single canonical `IX_*` name. `auth.expiresAt` is intentionally
 * NOT bound — it's written by `ix login`, not configured by env.
 */
export const CoreEnvBindings: Record<string, string> = {
  logLevel: "IX_LOG_LEVEL",
  secretsBackend: "IX_SECRETS_BACKEND",
  "auth.serviceUrl": "IX_AUTH_URL",
  "telemetry.enabled": "IX_TELEMETRY",
  theme: "IX_THEME",
  "updateCheck.enabled": "IX_UPDATE_CHECK",
  "updateCheck.intervalHours": "IX_UPDATE_CHECK_INTERVAL_HOURS",
};

/**
 * FR-020 — secrets owned by the `core` plugin. Resulting `SecretId`s
 * are `core.github-token`, `core.auth-access-token`,
 * `core.auth-refresh-token`. The auth-access-token has an env binding
 * for CI / non-interactive scripts; the refresh token does not.
 */
export const CoreSecretsSchema: SecretDeclaration[] = [
  {
    name: "github-token",
    description: "GitHub OAuth access token (device-flow login)",
    envVar: "IX_GITHUB_TOKEN",
  },
  {
    name: "auth-access-token",
    description: "IX auth-service access token",
    envVar: "IX_AUTH_ACCESS_TOKEN",
  },
  {
    name: "auth-refresh-token",
    description: "IX auth-service refresh token",
  },
];

export const CORE_ID = CORE_PLUGIN_ID;
