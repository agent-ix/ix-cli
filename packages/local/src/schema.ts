import { z } from "zod";

/**
 * `local` plugin's persistent configuration schema (FR-013, StR-005).
 *
 * Persisted at `~/.config/ix/config.d/local.yaml`. Fields here survive
 * across `ix` invocations; ephemeral / env-only settings (image
 * registry, timeouts, etc.) are still resolved at runtime by
 * `loadConfig()` in `config.ts`.
 *
 * Schema is `.strict()` per FR-013-AC-2 — unknown keys are rejected at
 * write time. Nested objects each carry a default object literal so
 * `safeParse({})` returns a fully-populated object (FR-011-AC-1).
 */

/**
 * A base domain must be a fully-qualified name with at least two
 * non-empty dot-separated labels and no whitespace. Rejects "",
 * ".", ".com", "foo.", "ix" — accepts "dev.ix", "luna.ix",
 * "agent-ix.dev", "foo.bar.baz".
 */
export function isValidBaseDomain(s: string): boolean {
  if (typeof s !== "string" || /\s/.test(s)) return false;
  const labels = s.split(".").filter((l) => l.length > 0);
  return labels.length >= 2;
}

const BaseDomainSchema = z
  .string()
  .refine(
    isValidBaseDomain,
    "must be a fully-qualified domain with at least two labels (e.g. dev.ix)",
  );

const StrictBooleanSchema = z.preprocess((raw) => {
  if (typeof raw !== "string") return raw;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return raw;
}, z.boolean());

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
    /**
     * Ingress hostname configuration.
     *
     * `hosts` is the list of base-domain suffixes the cluster answers
     * to. Every service publishes one ingress host per entry — e.g.
     * with `["dev.ix", "luna.ix"]` the identity service is reachable
     * at both `identity.dev.ix` and `identity.luna.ix`. The first
     * entry is canonical and is what single-host code paths (admin
     * email, login URL, display banners) use.
     *
     * `external` / `enableExternal` toggle public-routing on a single
     * external suffix and are independent of the multi-host list.
     *
     * `publicBaseUrl` is the canonical user-facing URL emitted in
     * emails (invites, password reset). Single-valued by design —
     * picking which host appears in an email is a product decision.
     */
    domain: z
      .object({
        hosts: z
          .array(BaseDomainSchema)
          .min(1, "domain.hosts must contain at least one entry")
          .default(["dev.ix"]),
        enableExternal: z.coerce.boolean().default(false),
        external: z.string().nullable().default(null),
        publicBaseUrl: z
          .string()
          .nullable()
          .refine(
            (v) => v === null || /^https?:\/\//.test(v),
            "must start with http:// or https://",
          )
          .default(null),
      })
      .strict()
      .default({
        hosts: ["dev.ix"],
        enableExternal: false,
        external: null,
        publicBaseUrl: null,
      }),
    /**
     * Cloudflare Tunnel — opt-in external exposure (FR-038).
     *
     * `autoStart` controls whether `ix cluster start` brings up the
     * shared `cloudflared` deployment after the cluster is reachable.
     * Even when true, bringup is a no-op if no Cloudflare token can
     * be resolved (env var or SecretsService) — the cluster never
     * fails because of a missing tunnel credential.
     *
     * `baseDomain` is the wildcard suffix the tunnel terminates
     * (must match the `*.<baseDomain>` CNAME in the Cloudflare zone).
     * `tunnelId` is informational — useful for `ix tunnel status`
     * output — and is NOT used by the install path.
     */
    tunnel: z
      .object({
        autoStart: StrictBooleanSchema.default(false),
        baseDomain: BaseDomainSchema.default("agent-ix.dev"),
        tunnelId: z.string().nullable().default(null),
      })
      .strict()
      .default({
        autoStart: false,
        baseDomain: "agent-ix.dev",
        tunnelId: null,
      }),
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
  {
    name: "cloudflare-tunnel-token",
    description:
      "Cloudflare Tunnel token issued by the CF dashboard (Zero Trust → Tunnels). Required by `ix tunnel up`.",
    required: false,
    envVar: "IX_CF_TUNNEL_TOKEN",
  },
] as const;

/**
 * Optional `IX_*` env-var bindings applied as the highest-precedence
 * layer over `~/.config/ix/config.d/local.yaml`. The legacy `IX_*`
 * timeout / version env vars are NOT in this map — they are read by
 * `loadConfig()` in `config.ts` directly because those values are
 * ephemeral overrides, not persistent config.
 *
 * The `domain.*` keys are deliberately NOT bound here — the generic
 * env layer only sets raw strings, but `domain.hosts` is an array,
 * `domain.enableExternal` needs proper "true"/"false" parsing
 * (`z.coerce.boolean` treats any non-empty string as true), and
 * `domain.publicBaseUrl` needs trim+empty-string handling. All four
 * are applied as overrides inside `loadConfig()` instead.
 */
export const LocalEnvBindings: Record<string, string> = {
  "concurrency.dockerPull": "IX_POOL_DOCKER_PULL",
  "concurrency.helmInstall": "IX_POOL_HELM_INSTALL",
  "concurrency.kubectlWatch": "IX_POOL_KUBECTL_WATCH",
};

export const LOCAL_PLUGIN_ID = "local" as const;
