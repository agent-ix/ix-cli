/**
 * FR-037 — Multi-Host Ingress Config
 * Validated configuration model for all commands that render or apply manifests.
 */

import { ConfigService } from "@agent-ix/ix-cli-core";

import {
  isValidBaseDomain,
  LocalConfigSchema,
  LocalEnvBindings,
  LOCAL_PLUGIN_ID,
} from "./schema.js";

/**
 * Kubernetes namespace contract.
 *
 * Four-tier model:
 * - `system`   — operator-only system trust (admin-bootstrap Secret, ClusterRoles, NetworkPolicies). No pods.
 * - `auth`     — identity / auth-service / permission-service. Trust root.
 * - `platform` — shared infrastructure: npm-proxy, pypi-proxy, postgres, redis, rabbitmq, vault, gateways.
 * - `apps`     — application services (default for charts that do not declare their own namespace).
 *
 * See ix-cli `spec/functional/local/auth.md` and auth/NFR-003.
 */
export const IX_SYSTEM_NAMESPACE = "system";
export const IX_AUTH_NAMESPACE = "auth";
export const IX_PLATFORM_NAMESPACE = "platform";
export const IX_APPS_NAMESPACE = "apps";

/** FR-009 — cluster bring-up defaults */
export interface ClusterConfig {
  defaultTags: string[];
  extraApps: string[];
  skipApps: string[];
}

/**
 * Load the `cluster:` section of `~/.config/ix/config.d/local.yaml` via
 * the shared `ConfigService`. Schema validation is enforced by
 * `LocalConfigSchema`; any malformed key triggers FR-011-AC-1's
 * defaulting + incident recording (visible via `ix config doctor`).
 */
export function loadClusterConfig(): ClusterConfig {
  const cfg = ConfigService.forPlugin(LOCAL_PLUGIN_ID, LocalConfigSchema, {
    envBindings: LocalEnvBindings,
  });
  return cfg.get().cluster;
}

/** FR-038 — Cloudflare Tunnel opt-in exposure config */
export interface TunnelExposedEntry {
  hostname: string | null;
}

export interface TunnelConfig {
  autoStart: boolean;
  baseDomain: string;
  tunnelId: string | null;
  exposed: Record<string, TunnelExposedEntry>;
}

/**
 * Load the `tunnel:` section of `~/.config/ix/config.d/local.yaml`. Pure
 * config read — no credential resolution and no cluster I/O. The
 * Cloudflare token lives in the SecretsService (see `tunnel/credentials.ts`).
 */
export function loadTunnelConfig(): TunnelConfig {
  const cfg = ConfigService.forPlugin(LOCAL_PLUGIN_ID, LocalConfigSchema, {
    envBindings: LocalEnvBindings,
  });
  return cfg.get().tunnel;
}

/**
 * Persist a mutation to `tunnel.exposed`. Called by `ix tunnel expose`
 * / `unexpose` to record operator intent. Uses ConfigService's edit
 * pathway so the file remains schema-validated on write.
 */
export function updateTunnelExposed(
  mutate: (
    current: Record<string, TunnelExposedEntry>,
  ) => Record<string, TunnelExposedEntry>,
): void {
  const cfg = ConfigService.forPlugin(LOCAL_PLUGIN_ID, LocalConfigSchema, {
    envBindings: LocalEnvBindings,
  });
  const current = cfg.get();
  // Use `replace` rather than `set`: ConfigService.set deep-merges the
  // patch into the existing file, which means absent keys mean "no
  // change" — so a mutate that DELETES an entry from `exposed` would
  // never propagate to disk. `replace` writes the full validated value,
  // letting deletions take effect.
  cfg.replace({
    ...current,
    tunnel: {
      ...current.tunnel,
      exposed: mutate(current.tunnel.exposed ?? {}),
    },
  });
}

export interface IxConfig {
  /**
   * Full ingress host suffix list. Length >= 1. Every service
   * publishes one ingress host per entry (e.g. `identity.dev.ix`,
   * `identity.luna.ix`). The first entry is canonical.
   */
  hosts: string[];
  /**
   * Canonical (first) host. Alias for `hosts[0]`. Single-host call
   * sites (admin email, login URL, display banners) read this and
   * are unaffected by multi-host config.
   */
  internalBaseDomain: string;
  externalBaseDomain: string | null;
  enableExternalHost: boolean;
  /**
   * Operator-supplied canonical public base URL for user-facing links
   * (invite emails, password reset, email verify). Becomes
   * `global.publicBaseUrl` to charts that emit URLs in emails (e.g.
   * identity). Null when unset; charts that need it MUST fail loudly
   * rather than silently emitting localhost.
   */
  publicBaseUrl: string | null;
  imageTag: string;
  imageRegistry: string;
  helmChartRegistry: string;
  /** GitHub org under which deployable Helm charts are published */
  org: string;
  kindClusterName: string;
  certManagerVersion: string;
  certManagerTimeoutSeconds: number;
  certWaitTimeoutSeconds: number;
  ingressNginxVersion: string;
  ingressNginxTimeoutSeconds: number;
  rolloutTimeoutSeconds: number;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

function parsePositiveInt(name: string, raw: string, fallback: number): number {
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new ConfigValidationError(
      `${name} must be a positive integer (got: ${JSON.stringify(raw)})`,
    );
  }
  return n;
}

/**
 * Helm `--set-string global.*` flags shared by every install path
 * (source single-service, image single-service, image umbrella).
 *
 * Image-tag handling is intentionally NOT included here because each
 * call site sets the tag differently (always vs. only-when-overridden,
 * and `global.imageTag` vs. `ix-service.image.tag`).
 *
 * The first host is sent as `global.internalBaseDomain` (unchanged
 * contract for charts that only know the singular value). Any
 * additional hosts are sent as an indexed `global.extraBaseDomains`
 * array, which the `ix-service` chart fans out into one ingress host
 * per (service, suffix) pair.
 */
export function buildGlobalSetArgs(config: IxConfig): string[] {
  const args = [
    "--set-string",
    `global.imageRegistry=${config.imageRegistry}`,
    "--set-string",
    `global.internalBaseDomain=${config.hosts[0]}`,
  ];
  config.hosts.slice(1).forEach((host, i) => {
    args.push("--set-string", `global.extraBaseDomains[${i}]=${host}`);
  });
  if (config.enableExternalHost && config.externalBaseDomain) {
    args.push(
      "--set-string",
      "global.enableExternalHost=true",
      "--set-string",
      `global.externalBaseDomain=${config.externalBaseDomain}`,
    );
  }
  if (config.publicBaseUrl) {
    args.push("--set-string", `global.publicBaseUrl=${config.publicBaseUrl}`);
  }
  return args;
}

/**
 * Helm `--set-string` flags that turn on tunnel exposure for one
 * release. Returns `[]` when this release isn't in `tunnel.exposed`,
 * so the install paths can append unconditionally.
 *
 * Every service-wrapper chart at this org composes ix-service as a
 * named subchart, so per-service ingress keys live at
 * `ix-service.ingress.<key>` (single-service release) or
 * `<entry>.ix-service.ingress.<key>` (umbrella release). That double
 * prefix is intentional and deploy-specific — flipping
 * `exposeOnTunnel` MUST hit the actual ix-service values, not the
 * wrapper-chart's own values, otherwise the toggle silently no-ops
 * (which would be a security trap).
 *
 * `entryKey` is the umbrella subchart name; pass `null` for
 * single-service releases. The `hostname` override, when set, is
 * appended to the same prefix's `ingress.extraHosts[0]`.
 */
export function buildTunnelSetArgs(
  tunnel: TunnelConfig,
  releaseName: string,
  entryKey: string | null,
): string[] {
  const entry = tunnel.exposed[releaseName];
  if (!entry) return [];
  const prefix = entryKey ? `${entryKey}.ix-service.` : "ix-service.";
  const args = [
    "--set-string",
    `global.tunnelBaseDomains[0]=${tunnel.baseDomain}`,
    "--set-string",
    `${prefix}ingress.exposeOnTunnel=true`,
  ];
  if (entry.hostname) {
    args.push(
      "--set-string",
      `${prefix}ingress.extraHosts[0]=${entry.hostname}`,
    );
  }
  return args;
}

/**
 * Parse `IX_INTERNAL_BASE_DOMAINS` (plural, comma-separated) into a
 * trimmed list. Empty string / unset → null (no override).
 */
function parseHostsEnv(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : null;
}

/**
 * Load and validate environment-based configuration.
 * Throws ConfigValidationError on any validation failure (FR-037-AC-5,
 * FR-037-CON-3).
 */
export function loadConfig(): IxConfig {
  const cfg = ConfigService.forPlugin(LOCAL_PLUGIN_ID, LocalConfigSchema, {
    envBindings: LocalEnvBindings,
  });
  const domain = cfg.get().domain;

  // Env-var overrides for domain.* (see schema.ts comment for why
  // these are applied here rather than via the generic env layer).
  let hosts = domain.hosts;
  const pluralEnv = parseHostsEnv(process.env.IX_INTERNAL_BASE_DOMAINS);
  if (pluralEnv) {
    hosts = pluralEnv;
  }
  // Back-compat: legacy singular env var still wins as a one-shot
  // override and pins the list to a single entry.
  const singularEnv = process.env.IX_INTERNAL_BASE_DOMAIN;
  if (singularEnv !== undefined && singularEnv !== "") {
    hosts = [singularEnv];
  }
  for (const h of hosts) {
    if (!isValidBaseDomain(h)) {
      throw new ConfigValidationError(
        `domain host ${JSON.stringify(h)} must be a fully-qualified domain with at least two labels (e.g. dev.ix)`,
      );
    }
  }
  if (hosts.length === 0) {
    throw new ConfigValidationError(
      "domain.hosts must contain at least one entry",
    );
  }

  const enableExternalHost =
    process.env.IX_ENABLE_EXTERNAL_HOST !== undefined
      ? process.env.IX_ENABLE_EXTERNAL_HOST.toLowerCase() === "true"
      : domain.enableExternal;

  const externalBaseDomain =
    process.env.IX_EXTERNAL_BASE_DOMAIN ?? domain.external;
  // FR-037-CON-3: cross-field rule enforced here rather than in Zod
  // because sibling-field validation across the domain group is
  // awkward to express in the schema.
  if (enableExternalHost && !externalBaseDomain) {
    throw new ConfigValidationError(
      "enableExternalHost=true requires externalBaseDomain to be set (env IX_EXTERNAL_BASE_DOMAIN or config domain.external)",
    );
  }

  const publicBaseUrlEnv = process.env.IX_PUBLIC_BASE_URL?.trim();
  const publicBaseUrl =
    publicBaseUrlEnv !== undefined
      ? publicBaseUrlEnv || null
      : domain.publicBaseUrl;
  if (publicBaseUrl && !/^https?:\/\//.test(publicBaseUrl)) {
    throw new ConfigValidationError(
      "publicBaseUrl must start with http:// or https://",
    );
  }

  // image tag — defaults to "latest"; per-invocation override via env
  const imageTag = process.env.IX_IMAGE_TAG ?? "latest";

  return {
    hosts,
    internalBaseDomain: hosts[0],
    externalBaseDomain,
    enableExternalHost,
    publicBaseUrl,
    imageTag,
    imageRegistry: process.env.IX_IMAGE_REGISTRY ?? "ghcr.io/agent-ix",
    helmChartRegistry: process.env.IX_HELM_CHART_REGISTRY ?? "ghcr.io",
    org: process.env.IX_ORG ?? "agent-ix",
    kindClusterName: process.env.IX_KIND_CLUSTER_NAME ?? "platform",
    certManagerVersion: process.env.IX_CERT_MANAGER_VERSION ?? "v1.14.5",
    certManagerTimeoutSeconds: parsePositiveInt(
      "IX_CERT_MANAGER_TIMEOUT_SECONDS",
      process.env.IX_CERT_MANAGER_TIMEOUT_SECONDS ?? "",
      180,
    ),
    certWaitTimeoutSeconds: parsePositiveInt(
      "IX_CERT_WAIT_TIMEOUT_SECONDS",
      process.env.IX_CERT_WAIT_TIMEOUT_SECONDS ?? "",
      120,
    ),
    ingressNginxVersion: process.env.IX_INGRESS_NGINX_VERSION ?? "v1.15.1",
    ingressNginxTimeoutSeconds: parsePositiveInt(
      "IX_INGRESS_NGINX_TIMEOUT_SECONDS",
      process.env.IX_INGRESS_NGINX_TIMEOUT_SECONDS ?? "",
      180,
    ),
    rolloutTimeoutSeconds: parsePositiveInt(
      "IX_ROLLOUT_TIMEOUT_SECONDS",
      process.env.IX_ROLLOUT_TIMEOUT_SECONDS ?? "",
      300,
    ),
  };
}
