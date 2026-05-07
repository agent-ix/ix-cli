/**
 * FR-038 — Cloudflare Tunnel install / uninstall.
 *
 * The `cloudflared` chart is a singleton: one release in the
 * `platform` namespace, one shared tunnel terminating
 * `*.<tunnel.baseDomain>` and forwarding to ingress-nginx. There is
 * no app-expansion, no per-app secret contract, and no umbrella;
 * this is much simpler than `runImageModeUp`.
 */

import { execa } from "execa";
import type { IxConfig } from "../config.js";
import { IX_PLATFORM_NAMESPACE } from "../config.js";
import { ensureNamespace } from "../namespaces.js";
import {
  resolveGhcrToken,
  resolveGhcrTokenNonInteractive,
} from "../credentials.js";
import { firstRunSetup, resolveCloudflareToken } from "./credentials.js";

export const TUNNEL_RELEASE_NAME = "cloudflared";
// Cloudflared lives in the `platform` namespace alongside other shared
// infrastructure (postgres, npm-proxy, pypi-proxy, …). It's not bundled
// into any App's umbrella — it's a cluster-wide singleton.
export const TUNNEL_NAMESPACE = IX_PLATFORM_NAMESPACE;
export const TUNNEL_CHART_PATH = "agent-ix/helm-charts/cloudflared";
// Tracks the helm-charts monorepo version (the tag drives every chart's
// published version regardless of Chart.yaml; bump this whenever the
// helm-charts repo cuts a new tag).
export const TUNNEL_CHART_VERSION = "0.10.3";

export interface TunnelInstallOptions {
  /** Override resolved chart version (testing / pinning). */
  chartVersion?: string;
  /** Override registry host (defaults to `config.helmChartRegistry`). */
  registryOverride?: string;
}

export interface TunnelInstallResult {
  installed: boolean;
  /** Reason for skip — `null` when installed. */
  skippedReason: string | null;
}

/**
 * Install or upgrade the shared cloudflared deployment.
 *
 * Returns `{ installed: false, skippedReason }` when no token is
 * resolvable — the caller (auto-start hook) treats that as a silent
 * no-op so cluster bringup keeps working without Cloudflare creds.
 * `requireToken: true` flips that into an exception (`ix tunnel up`).
 */
export async function runTunnelUp(
  config: IxConfig,
  opts: TunnelInstallOptions & { requireToken?: boolean } = {},
): Promise<TunnelInstallResult> {
  // `requireToken: true` (explicit `ix tunnel up`) runs the first-run
  // helper which captures the token + base domain on a TTY and throws
  // off one. The auto-start hook keeps the silent-skip path.
  let token: string | null;
  if (opts.requireToken) {
    token = (await firstRunSetup()).token;
  } else {
    token = await resolveCloudflareToken();
  }
  if (!token) {
    return {
      installed: false,
      skippedReason: "no Cloudflare token (set IX_CF_TUNNEL_TOKEN)",
    };
  }

  await ensureNamespace(TUNNEL_NAMESPACE);

  const ghcrToken = opts.requireToken
    ? await resolveGhcrToken(false)
    : await resolveGhcrTokenNonInteractive();
  if (!ghcrToken) {
    return {
      installed: false,
      skippedReason: "no GHCR token for cloudflared chart pull",
    };
  }
  const registry = opts.registryOverride ?? config.helmChartRegistry;
  const chartRef = `oci://${registry}/${TUNNEL_CHART_PATH}`;
  const chartVersion = opts.chartVersion ?? TUNNEL_CHART_VERSION;

  await execa(
    "helm",
    ["registry", "login", registry, "-u", "_token", "--password-stdin"],
    { input: ghcrToken },
  );

  await execa(
    "helm",
    [
      "upgrade",
      "--install",
      TUNNEL_RELEASE_NAME,
      chartRef,
      "--version",
      chartVersion,
      "--namespace",
      TUNNEL_NAMESPACE,
      "--create-namespace",
      "--take-ownership",
      "--set-string",
      `tunnelToken=${token}`,
      "--wait",
      // Helm's 5min default isn't enough on slow image pulls or when QUIC
      // handshake to the Cloudflare edge takes a beat. Without this the
      // command exits "context deadline exceeded" while the pod is still
      // converging.
      "--timeout",
      "10m",
    ],
    { all: true },
  );

  return { installed: true, skippedReason: null };
}

/**
 * Uninstall the cloudflared release. Idempotent: a missing release is
 * not an error.
 */
export async function runTunnelDown(): Promise<void> {
  try {
    await execa("helm", [
      "uninstall",
      TUNNEL_RELEASE_NAME,
      "--namespace",
      TUNNEL_NAMESPACE,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|release: not found/i.test(msg)) return;
    throw err;
  }
}

export interface TunnelStatus {
  installed: boolean;
  ready: boolean;
  podPhase: string | null;
  exposedHosts: string[];
}

interface KubectlPod {
  status?: { phase?: string };
}

interface KubectlIngress {
  metadata?: { namespace?: string; name?: string };
  spec?: { rules?: Array<{ host?: string }> };
}

/**
 * Quick status snapshot. Reports whether cloudflared is installed,
 * its pod phase, and which Ingress hosts in the cluster end with the
 * configured tunnel base domain.
 */
export async function getTunnelStatus(
  baseDomain: string,
): Promise<TunnelStatus> {
  let installed = false;
  let podPhase: string | null = null;

  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "pods",
      "--namespace",
      TUNNEL_NAMESPACE,
      "-l",
      "app.kubernetes.io/name=cloudflared",
      "-o",
      "json",
    ]);
    const parsed = JSON.parse(stdout) as { items?: KubectlPod[] };
    const pods = parsed.items ?? [];
    if (pods.length > 0) {
      installed = true;
      podPhase = pods[0].status?.phase ?? null;
    }
  } catch {
    // namespace doesn't exist or kubectl unavailable — treat as not installed.
  }

  const exposedHosts: string[] = [];
  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "ingress",
      "--all-namespaces",
      "-o",
      "json",
    ]);
    const parsed = JSON.parse(stdout) as { items?: KubectlIngress[] };
    const suffix = `.${baseDomain}`;
    for (const ing of parsed.items ?? []) {
      for (const rule of ing.spec?.rules ?? []) {
        const host = rule.host;
        if (typeof host === "string" && host.endsWith(suffix)) {
          exposedHosts.push(host);
        }
      }
    }
  } catch {
    // ignore — best-effort probe.
  }

  return {
    installed,
    ready: podPhase === "Running",
    podPhase,
    exposedHosts: [...new Set(exposedHosts)].sort(),
  };
}
