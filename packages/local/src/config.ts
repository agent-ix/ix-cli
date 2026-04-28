/**
 * FR-006 — Hostname and Scope Configuration
 * Validated configuration model for all commands that render or apply manifests.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const IX_CONFIG_PATH = path.join(os.homedir(), ".ix", "config.yaml");

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
  if (!fs.existsSync(IX_CONFIG_PATH)) return { ...CLUSTER_DEFAULTS };

  let raw: string;
  try {
    raw = fs.readFileSync(IX_CONFIG_PATH, "utf8");
  } catch (err) {
    throw new ConfigValidationError(
      `Failed to read ${IX_CONFIG_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ConfigValidationError(
      `Failed to parse ${IX_CONFIG_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object")
    return { ...CLUSTER_DEFAULTS };

  const cfg = parsed as Record<string, unknown>;
  const cluster = cfg["cluster"];
  if (cluster === undefined || cluster === null) return { ...CLUSTER_DEFAULTS };
  if (typeof cluster !== "object" || Array.isArray(cluster)) {
    throw new ConfigValidationError(
      `${IX_CONFIG_PATH}: 'cluster' must be an object`,
    );
  }

  const c = cluster as Record<string, unknown>;

  function resolveStringArray(key: string, fallback: string[]): string[] {
    const val = c[key];
    if (val === undefined || val === null) return fallback;
    if (!Array.isArray(val) || !val.every((v) => typeof v === "string")) {
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
}

export interface IxConfig {
  internalBaseDomain: string;
  externalBaseDomain: string | null;
  enableExternalHost: boolean;
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
 * Load and validate environment-based configuration.
 * Throws ConfigValidationError on any validation failure (FR-006-AC-6).
 */
export function loadConfig(): IxConfig {
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

  return {
    internalBaseDomain,
    externalBaseDomain,
    enableExternalHost,
    imageTag,
    imageRegistry: process.env.IX_IMAGE_REGISTRY ?? "ghcr.io/agent-ix",
    helmChartRegistry: process.env.IX_HELM_CHART_REGISTRY ?? "ghcr.io",
    org: process.env.IX_ORG ?? "agent-ix",
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
    rolloutTimeoutSeconds: parsePositiveInt(
      "IX_ROLLOUT_TIMEOUT_SECONDS",
      process.env.IX_ROLLOUT_TIMEOUT_SECONDS ?? "",
      300,
    ),
  };
}
