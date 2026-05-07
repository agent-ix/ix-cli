/**
 * FR-038 — Per-app Cloudflare Tunnel exposure.
 *
 * `exposeApp` adds the configured tunnel base domain (e.g.
 * `agent-ix.dev`) to a running release's `global.extraBaseDomains` and
 * flips `ingress.exposeExtraHosts: true` on the entry-point service so
 * the `ix-service` chart renders `<service>.<baseDomain>` Ingress
 * hosts. Cloudflared (already installed via `runTunnelUp`) terminates
 * the wildcard and forwards by Host header to ingress-nginx.
 *
 * Apps (umbrella charts with subcharts) flip the toggle on the
 * `entry` subchart only — fanning every subchart to the public suffix
 * would breach the FR-037 security boundary. Single-service releases
 * flip it on the release itself.
 *
 * Implementation: read current values via `helm get values -o json`,
 * merge in our additions, write a temp values file, run
 * `helm upgrade --reuse-values -f <merged>`. Using `-f` instead of
 * positional `--set` avoids the indexed-array overwrite semantics
 * helm applies to `--set foo[i]=...`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { stringify as stringifyYaml } from "yaml";
import type { IxConfig } from "../config.js";
import type { Deployable } from "../discovery.js";
import { resolveDeployableNamespace } from "../discovery.js";
import { findDeployable } from "../registry.js";
import { getReleaseIngressUrls } from "../ingress.js";

export interface ExposeOptions {
  /** Override the auto-derived `<app>.<baseDomain>` hostname. */
  hostname?: string;
  /** Test seam — overrides the helm chart-ref used in upgrade. */
  registryOverride?: string;
}

export interface ExposeResult {
  release: string;
  namespace: string;
  baseDomain: string;
  /** The hostname(s) added to the ingress. */
  hostsAdded: string[];
  /** Full set of ingress URLs after the upgrade. */
  ingressUrls: string[];
}

/**
 * Derive the canonical hostname for an app. Pure function so tests
 * can pin it without spinning up the registry.
 */
export function deriveHostname(appName: string, baseDomain: string): string {
  return `${appName}.${baseDomain}`;
}

interface CurrentValues {
  global?: {
    extraBaseDomains?: unknown;
    [k: string]: unknown;
  };
  ingress?: {
    exposeExtraHosts?: boolean;
    extraHosts?: unknown;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

function ensureStringArray(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((s): s is string => typeof s === "string")
    : [];
}

/**
 * Compute the values overlay that adds `baseDomain` to global extras
 * and exposes the entry service. Pure — exported for tests.
 *
 * @param current  result of `helm get values -o json`
 * @param baseDomain  e.g. "agent-ix.dev"
 * @param entryKey  null for service releases (toggle at top level);
 *                  the subchart name for umbrella releases.
 * @param hostnameOverride  optional explicit hostname appended to
 *                  `ingress.extraHosts` of the entry service.
 */
export function buildExposeOverlay(
  current: CurrentValues,
  baseDomain: string,
  entryKey: string | null,
  hostnameOverride: string | null,
): Record<string, unknown> {
  const extras = ensureStringArray(current.global?.extraBaseDomains);
  const nextExtras = extras.includes(baseDomain)
    ? extras
    : [...extras, baseDomain];

  const overlay: Record<string, unknown> = {
    global: {
      ...(current.global ?? {}),
      extraBaseDomains: nextExtras,
    },
  };

  const entryBlock = entryKey
    ? ((current[entryKey] as Record<string, unknown> | undefined) ?? {})
    : current;
  const entryIngress =
    (entryBlock.ingress as Record<string, unknown> | undefined) ?? {};
  const existingExtraHosts = ensureStringArray(entryIngress.extraHosts);
  const nextExtraHosts =
    hostnameOverride && !existingExtraHosts.includes(hostnameOverride)
      ? [...existingExtraHosts, hostnameOverride]
      : existingExtraHosts;

  const updatedIngress = {
    ...entryIngress,
    exposeExtraHosts: true,
    ...(nextExtraHosts.length > 0 ? { extraHosts: nextExtraHosts } : {}),
  };

  if (entryKey) {
    overlay[entryKey] = { ...entryBlock, ingress: updatedIngress };
  } else {
    overlay.ingress = updatedIngress;
  }

  return overlay;
}

/**
 * Inverse of `buildExposeOverlay`. Removes `baseDomain` from extras
 * and turns `exposeExtraHosts` back off on the entry service. Leaves
 * any operator-supplied `extraHosts` alone unless they end with the
 * removed suffix (those would now point nowhere).
 */
export function buildUnexposeOverlay(
  current: CurrentValues,
  baseDomain: string,
  entryKey: string | null,
): Record<string, unknown> {
  const extras = ensureStringArray(current.global?.extraBaseDomains);
  const nextExtras = extras.filter((d) => d !== baseDomain);

  const overlay: Record<string, unknown> = {
    global: {
      ...(current.global ?? {}),
      extraBaseDomains: nextExtras,
    },
  };

  const entryBlock = entryKey
    ? ((current[entryKey] as Record<string, unknown> | undefined) ?? {})
    : current;
  const entryIngress =
    (entryBlock.ingress as Record<string, unknown> | undefined) ?? {};
  const suffix = `.${baseDomain}`;
  const remainingExtraHosts = ensureStringArray(entryIngress.extraHosts).filter(
    (h) => !h.endsWith(suffix),
  );

  const updatedIngress = {
    ...entryIngress,
    exposeExtraHosts: false,
    ...(remainingExtraHosts.length > 0
      ? { extraHosts: remainingExtraHosts }
      : { extraHosts: [] }),
  };

  if (entryKey) {
    overlay[entryKey] = { ...entryBlock, ingress: updatedIngress };
  } else {
    overlay.ingress = updatedIngress;
  }

  return overlay;
}

interface ResolvedRelease {
  releaseName: string;
  namespace: string;
  entryKey: string | null;
  deployable: Deployable;
}

async function resolveRelease(
  appName: string,
  registry: Deployable[],
): Promise<ResolvedRelease> {
  const deployable = findDeployable(registry, appName);
  return {
    releaseName: deployable.name,
    namespace: resolveDeployableNamespace(deployable),
    // For umbrella apps, FR-037-AC-7 requires per-subchart toggling;
    // route the ingress flip through the entry subchart's values.
    entryKey: deployable.role === "app" ? (deployable.entry ?? null) : null,
    deployable,
  };
}

async function getCurrentValues(
  release: string,
  namespace: string,
): Promise<CurrentValues> {
  try {
    const { stdout } = await execa("helm", [
      "get",
      "values",
      release,
      "--namespace",
      namespace,
      "-o",
      "json",
      "--all",
    ]);
    const parsed = JSON.parse(stdout) as CurrentValues | null;
    return parsed ?? {};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/release: not found|Error: release/i.test(msg)) {
      throw new Error(
        `No helm release named '${release}' in namespace '${namespace}'. Run \`ix up ${release}\` first.`,
      );
    }
    throw err;
  }
}

async function helmUpgradeWithOverlay(
  release: string,
  namespace: string,
  chartRef: string,
  chartVersion: string,
  overlay: Record<string, unknown>,
): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-tunnel-expose-"));
  const valuesFile = path.join(tmpDir, "values.yaml");
  try {
    fs.writeFileSync(valuesFile, stringifyYaml(overlay));
    await execa(
      "helm",
      [
        "upgrade",
        release,
        chartRef,
        "--version",
        chartVersion,
        "--namespace",
        namespace,
        "--reuse-values",
        "-f",
        valuesFile,
      ],
      { all: true },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function exposeApp(
  appName: string,
  registry: Deployable[],
  config: IxConfig,
  baseDomain: string,
  opts: ExposeOptions = {},
): Promise<ExposeResult> {
  const { releaseName, namespace, entryKey, deployable } = await resolveRelease(
    appName,
    registry,
  );
  const current = await getCurrentValues(releaseName, namespace);
  const overlay = buildExposeOverlay(
    current,
    baseDomain,
    entryKey,
    opts.hostname ?? null,
  );
  const registryHost = opts.registryOverride ?? config.helmChartRegistry;
  const chartRef = `oci://${registryHost}/${deployable.chartRepository}/${deployable.name}`;
  await helmUpgradeWithOverlay(
    releaseName,
    namespace,
    chartRef,
    deployable.version,
    overlay,
  );
  const ingressUrls = await getReleaseIngressUrls(releaseName, namespace);

  const hostsAdded = opts.hostname
    ? [opts.hostname]
    : ingressUrls
        .map((u) => new URL(u).host)
        .filter((h) => h.endsWith(`.${baseDomain}`));

  return {
    release: releaseName,
    namespace,
    baseDomain,
    hostsAdded: [...new Set(hostsAdded)].sort(),
    ingressUrls,
  };
}

export async function unexposeApp(
  appName: string,
  registry: Deployable[],
  config: IxConfig,
  baseDomain: string,
): Promise<ExposeResult> {
  const { releaseName, namespace, entryKey, deployable } = await resolveRelease(
    appName,
    registry,
  );
  const current = await getCurrentValues(releaseName, namespace);
  const overlay = buildUnexposeOverlay(current, baseDomain, entryKey);
  const chartRef = `oci://${config.helmChartRegistry}/${deployable.chartRepository}/${deployable.name}`;
  await helmUpgradeWithOverlay(
    releaseName,
    namespace,
    chartRef,
    deployable.version,
    overlay,
  );
  const ingressUrls = await getReleaseIngressUrls(releaseName, namespace);
  return {
    release: releaseName,
    namespace,
    baseDomain,
    hostsAdded: [],
    ingressUrls,
  };
}
