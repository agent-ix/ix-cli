import { X509Certificate } from "node:crypto";
import { execa } from "execa";

const WILDCARD_CERT_NAMESPACE = "default";
const WILDCARD_CERT_NAME = "ix-dev-wildcard-cert";
const WILDCARD_TLS_SECRET = "ix-dev-wildcard-tls";

const INGRESS_TLS_NAMESPACE = "ingress-nginx";
const INGRESS_TLS_CERT_NAME = "ix-tls";
const INGRESS_TLS_SECRET = "ix-tls";

const DEFAULT_WAIT_TIMEOUT_SECONDS = 120;

export function wildcardCertYaml(hosts: string[]): string {
  const sans = hosts.map((h) => `    - "*.${h}"`).join("\n");
  return `
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: ${WILDCARD_CERT_NAME}
  namespace: ${WILDCARD_CERT_NAMESPACE}
spec:
  secretName: ${WILDCARD_TLS_SECRET}
  dnsNames:
${sans}
  issuerRef:
    name: ix-local-issuer
    kind: ClusterIssuer
    group: cert-manager.io
`.trim();
}

export function ingressTlsCertYaml(hosts: string[]): string {
  const sans = hosts.map((h) => `    - "*.${h}"`).join("\n");
  return `
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: ${INGRESS_TLS_CERT_NAME}
  namespace: ${INGRESS_TLS_NAMESPACE}
spec:
  secretName: ${INGRESS_TLS_SECRET}
  dnsNames:
${sans}
  issuerRef:
    name: ix-local-issuer
    kind: ClusterIssuer
    group: cert-manager.io
`.trim();
}

interface CertTarget {
  name: string;
  namespace: string;
}

const CERT_TARGETS: readonly CertTarget[] = [
  { name: WILDCARD_CERT_NAME, namespace: WILDCARD_CERT_NAMESPACE },
  { name: INGRESS_TLS_CERT_NAME, namespace: INGRESS_TLS_NAMESPACE },
];

async function waitForCertReady(
  targets: readonly CertTarget[],
  timeoutSeconds: number,
): Promise<void> {
  const pollMs = 5000;
  const timeoutMs = timeoutSeconds * 1000;
  const startNs = process.hrtime.bigint();
  const elapsedMs = () =>
    Number((process.hrtime.bigint() - startNs) / 1_000_000n);

  const pending = new Set(targets.map((t) => `${t.namespace}/${t.name}`));
  while (elapsedMs() < timeoutMs && pending.size > 0) {
    for (const t of targets) {
      const key = `${t.namespace}/${t.name}`;
      if (!pending.has(key)) continue;
      try {
        const { stdout } = await execa("kubectl", [
          "get",
          "certificate",
          t.name,
          "-n",
          t.namespace,
          "-o",
          "jsonpath={.status.conditions[?(@.type=='Ready')].status}",
        ]);
        if (stdout.trim() === "True") pending.delete(key);
      } catch {
        // not ready yet
      }
    }
    if (pending.size === 0) return;
    const remaining = timeoutMs - elapsedMs();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining)));
  }
  const missing = [...pending].join(", ");
  throw new Error(
    `Certificate(s) did not become Ready within ${timeoutSeconds}s: ${missing}. ` +
      `Run: kubectl describe certificate -A`,
  );
}

/**
 * Apply both the wildcard and ingress-nginx Certificate manifests and
 * wait for cert-manager to issue the underlying Secrets. The ingress
 * deployment patches (default-ssl-certificate arg, configmap tweaks)
 * are NOT re-applied here — those are init-time concerns that don't
 * change when hosts do.
 */
export async function applyClusterCerts(
  hosts: string[],
  opts: { waitTimeoutSeconds?: number } = {},
): Promise<void> {
  await execa("kubectl", ["apply", "-f", "-"], {
    input: wildcardCertYaml(hosts),
    all: true,
  });
  await execa("kubectl", ["apply", "-f", "-"], {
    input: ingressTlsCertYaml(hosts),
    all: true,
  });
  await waitForCertReady(
    CERT_TARGETS,
    opts.waitTimeoutSeconds ?? DEFAULT_WAIT_TIMEOUT_SECONDS,
  );
}

/**
 * Read the DNS SANs from the TLS Secret backing a Certificate.
 * Returns null when the Secret does not exist (i.e., the cert was
 * never issued). Other kubectl failures propagate.
 */
export async function getCertSans(
  secretName: string,
  namespace: string,
): Promise<string[] | null> {
  let stdout: string;
  try {
    const result = await execa(
      "kubectl",
      [
        "get",
        "secret",
        secretName,
        "-n",
        namespace,
        "-o",
        "jsonpath={.data.tls\\.crt}",
      ],
      { all: true },
    );
    stdout = result.stdout;
  } catch (e) {
    // Match the error-shape convention used in init-cluster-controller:
    // execa surfaces interleaved stdout/stderr on `.all` when run with
    // `{ all: true }`, falling back to `.message` otherwise.
    const err = e as { all?: string; message?: string };
    const msg = err.all ?? err.message ?? "";
    if (/NotFound|not found/i.test(msg)) return null;
    throw e;
  }
  if (!stdout) return null;
  const pem = Buffer.from(stdout, "base64").toString("utf8");
  const cert = new X509Certificate(pem);
  const subjectAltName = cert.subjectAltName ?? "";
  return subjectAltName
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("DNS:"))
    .map((s) => s.slice(4).trim());
}

/**
 * True iff every `*.${host}` for `host ∈ configuredHosts` is present
 * in `currentSans`. Extra SANs in the cert are tolerated.
 */
export function certCoversHosts(
  currentSans: string[],
  configuredHosts: string[],
): boolean {
  const sans = new Set(currentSans);
  return configuredHosts.every((h) => sans.has(`*.${h}`));
}

/**
 * Verify the ingress-nginx TLS cert covers every configured host;
 * re-apply both Certificates if the cert is missing or stale.
 *
 * Returns whether a refresh was performed so callers can surface
 * the action to the user.
 */
export async function ensureClusterCertCoversHosts(
  hosts: string[],
  opts: { waitTimeoutSeconds?: number } = {},
): Promise<{ refreshed: boolean }> {
  const sans = await getCertSans(INGRESS_TLS_SECRET, INGRESS_TLS_NAMESPACE);
  if (sans !== null && certCoversHosts(sans, hosts)) {
    return { refreshed: false };
  }
  await applyClusterCerts(hosts, opts);
  return { refreshed: true };
}
