/**
 * Shared identity-service connectivity helpers used by FR-015, FR-016, FR-017, FR-018.
 *
 * Exporting resolveIdentityUrl and fetchJson as named exports allows tests to
 * vi.mock("../commands/auth-identity.js") and avoid real port-forward sleeps.
 *
 * NFR-005: identity /internal/* endpoints are NEVER reached via public Ingress.
 * Out-of-cluster callers use kubectl port-forward to 127.0.0.1 only.
 * In-cluster callers (KUBERNETES_SERVICE_HOST set) use in-cluster Service DNS.
 */

import { execa } from "execa";

/** NFR-005-AC-1: mode selection by KUBERNETES_SERVICE_HOST detection. */
export function isInCluster(): boolean {
  return Boolean(process.env.KUBERNETES_SERVICE_HOST);
}

/**
 * Resolve the identity base URL.
 *
 * Mode 1 (in-cluster): use in-cluster Service DNS directly.
 * Mode 2 (out-of-cluster): kubectl port-forward to 127.0.0.1 only (NFR-005-AC-2).
 *
 * @param localPort  Ephemeral local port for the port-forward (mode 2 only).
 */
export async function resolveIdentityUrl(localPort: number): Promise<{
  baseUrl: string;
  cleanup: () => void;
}> {
  // NFR-005-AC-1: in-cluster mode — no port-forward needed
  if (isInCluster()) {
    return {
      baseUrl: "http://identity.ix-system.svc.cluster.local:8000",
      cleanup: () => {},
    };
  }

  // NFR-005-AC-2: out-of-cluster — port-forward to 127.0.0.1 only
  const pfProc = execa(
    "kubectl",
    [
      "port-forward",
      "-n",
      "ix-system",
      "svc/identity",
      `127.0.0.1:${localPort}:8000`,
      "--pod-running-timeout=5s",
    ],
    { reject: false, all: true },
  );

  // Give the port-forward a moment to establish
  await new Promise((r) => setTimeout(r, 1500));

  return {
    baseUrl: `http://127.0.0.1:${localPort}`,
    cleanup: () => {
      pfProc.kill?.();
    },
  };
}

export async function fetchJson<T>(
  url: string,
  opts?: RequestInit,
): Promise<{ status: number; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const body = (await res.json()) as T;
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}
