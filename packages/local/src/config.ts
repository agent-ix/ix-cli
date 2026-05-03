/**
 * FR-006 — Hostname and Scope Configuration
 * Validated configuration model for all commands that render or apply manifests.
 */

import os from "node:os";
import path from "node:path";
import { loadIxCliConfig } from "@agent-ix/ix-cli-core";

const IX_CONFIG_PATH = path.join(os.homedir(), ".ix", "config.yaml");

interface LocalIxCliConfig {
  defaultOrg?: string;
  cluster?: {
    defaultTags?: string[];
    extraApps?: string[];
    skipApps?: string[];
  };
}

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

/** FR-009 — cluster bring-up defaults read from ~/.ix/config.yaml cluster: key */
export interface ClusterConfig {
  defaultTags: string[];
  extraApps: string[];
  skipApps: string[];
}

const CLUSTER_DEFAULTS: ClusterConfig = {
  defaultTags: ["ix-core"],
  extraApps: [],
  skipApps: [],
};

export function loadClusterConfig(): ClusterConfig {
  try {
    const cluster = (loadIxCliConfig() as LocalIxCliConfig).cluster;
    if (cluster === undefined || cluster === null)
      return { ...CLUSTER_DEFAULTS };
    if (typeof cluster !== "object" || Array.isArray(cluster)) {
      throw new ConfigValidationError(
        `${IX_CONFIG_PATH}: 'cluster' must be an object`,
      );
    }
    const c = cluster as Record<string, unknown>;

    function resolveStringArray(key: string, fallback: string[]): string[] {
      const val = c[key];
      if (val === undefined || val === null) return fallback;
      if (
        !Array.isArray(val) ||
        !val.every((v: unknown) => typeof v === "string")
      ) {
        throw new ConfigValidationError(
          `${IX_CONFIG_PATH}: cluster.${key} must be an array of strings`,
        );
      }
      return val as string[];
    }

    return {
      defaultTags: resolveStringArray(
        "defaultTags",
        CLUSTER_DEFAULTS.defaultTags,
      ),
      extraApps: resolveStringArray("extraApps", CLUSTER_DEFAULTS.extraApps),
      skipApps: resolveStringArray("skipApps", CLUSTER_DEFAULTS.skipApps),
    };
  } catch (err) {
    if (err instanceof ConfigValidationError) throw err;
    throw new ConfigValidationError(
      `Failed to read ${IX_CONFIG_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface IxConfig {
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
  ghcrToken: string | null;
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

function resolveConfiguredGhcrToken(): string | null {
  const envNames = [
    "IX_GHCR_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GHCR_TOKEN",
    "CR_PAT",
  ] as const;

  for (const envName of envNames) {
    const token = process.env[envName]?.trim();
    if (token) {
      return token;
    }
  }

  return null;
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
 */
export function buildGlobalSetArgs(config: IxConfig): string[] {
  const args = [
    "--set-string",
    `global.imageRegistry=${config.imageRegistry}`,
    "--set-string",
    `global.internalBaseDomain=${config.internalBaseDomain}`,
  ];
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
 * Load and validate environment-based configuration.
 * Throws ConfigValidationError on any validation failure (FR-006-AC-6).
 */
export function loadConfig(): IxConfig {
  const cliConfig = loadIxCliConfig() as LocalIxCliConfig;
  // FR-006-AC-1: default dev.ix — defined exactly once (CON-1)
  const internalBaseDomain = process.env.IX_INTERNAL_BASE_DOMAIN ?? "dev.ix";

  // FR-006-AC-5: must have at least two non-empty dot-separated labels.
  // Rejects "", ".", ".com", "foo.", "ix" — accepts "dev.ix", "foo.bar.baz".
  const labels = internalBaseDomain.split(".").filter((l) => l.length > 0);
  if (labels.length < 2 || /\s/.test(internalBaseDomain)) {
    throw new ConfigValidationError(
      "IX_INTERNAL_BASE_DOMAIN must be a fully-qualified domain with at least two labels (e.g. dev.ix)",
    );
  }

  const enableExternalHost =
    (process.env.IX_ENABLE_EXTERNAL_HOST ?? "false").toLowerCase() === "true";

  // FR-006-AC-3: external domain required when external host enabled
  const externalBaseDomain = process.env.IX_EXTERNAL_BASE_DOMAIN ?? null;
  if (enableExternalHost && !externalBaseDomain) {
    throw new ConfigValidationError(
      "IX_ENABLE_EXTERNAL_HOST=true requires IX_EXTERNAL_BASE_DOMAIN to be set",
    );
  }

  // FR-006-AC-2: default latest
  const imageTag = process.env.IX_IMAGE_TAG ?? "latest";

  const publicBaseUrl = process.env.IX_PUBLIC_BASE_URL?.trim() || null;
  if (publicBaseUrl && !/^https?:\/\//.test(publicBaseUrl)) {
    throw new ConfigValidationError(
      "IX_PUBLIC_BASE_URL must start with http:// or https://",
    );
  }

  return {
    internalBaseDomain,
    externalBaseDomain,
    enableExternalHost,
    publicBaseUrl,
    imageTag,
    imageRegistry: process.env.IX_IMAGE_REGISTRY ?? "ghcr.io/agent-ix",
    helmChartRegistry: process.env.IX_HELM_CHART_REGISTRY ?? "ghcr.io",
    org: process.env.IX_ORG ?? cliConfig.defaultOrg ?? "agent-ix",
    ghcrToken: resolveConfiguredGhcrToken(),
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
