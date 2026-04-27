/**
 * FR-007 — init-cluster Command
 * Full cluster bootstrap: kind create, cert-manager, ix-ca-issuer, wildcard TLS,
 * GHCR credentials, DNS instructions. Idempotent (FR-007-AC-1).
 */

import { execa } from "execa";
import type { IxConfig } from "../config.js";
import { resolveGhcrToken } from "../credentials.js";
import { PhaseTable } from "@agent-ix/ix-ui-cli";

/**
 * C2: Build a kubernetes.io/dockerconfigjson Secret manifest containing the
 * GHCR token and apply via stdin. The token never appears on the kubectl
 * command line, so it cannot leak via `ps aux` or shell history.
 */
function buildGhcrSecretManifest(token: string): string {
  const dockerconfig = {
    auths: {
      "ghcr.io": {
        username: "_token",
        password: token,
        auth: Buffer.from(`_token:${token}`).toString("base64"),
      },
    },
  };
  const encoded = Buffer.from(JSON.stringify(dockerconfig)).toString("base64");
  return [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: ghcr-credentials",
    "  namespace: default",
    "type: kubernetes.io/dockerconfigjson",
    "data:",
    `  .dockerconfigjson: ${encoded}`,
    "",
  ].join("\n");
}

const CERT_MANAGER_URL = (version: string) =>
  `https://github.com/jetstack/cert-manager/releases/download/${version}/cert-manager.yaml`;

const IX_CA_ISSUER_YAML = `
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: ix-ca-issuer
spec:
  selfSigned: {}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: ix-ca
  namespace: cert-manager
spec:
  isCA: true
  commonName: ix-local-ca
  secretName: ix-ca-secret
  privateKey:
    algorithm: ECDSA
    size: 256
  issuerRef:
    name: ix-ca-issuer
    kind: ClusterIssuer
    group: cert-manager.io
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: ix-local-issuer
spec:
  ca:
    secretName: ix-ca-secret
`.trim();

function wildcardCertYaml(domain: string): string {
  return `
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: ix-dev-wildcard-cert
  namespace: default
spec:
  secretName: ix-dev-wildcard-tls
  dnsNames:
    - "*.${domain}"
  issuerRef:
    name: ix-local-issuer
    kind: ClusterIssuer
    group: cert-manager.io
`.trim();
}

const INIT_STEPS = [
  "kind cluster",
  "cert-manager",
  "ca-issuer",
  "wildcard cert",
  "wait cert",
  "ghcr secret",
  "npm secret",
  "dns config",
] as const;

type InitStep = (typeof INIT_STEPS)[number];

export async function runInitCluster(
  config: IxConfig,
  reconfigureCredentials: boolean,
): Promise<void> {
  // Resolve credentials before the display starts — clack prompts need direct
  // terminal access.
  const ghcrToken = await resolveGhcrToken(reconfigureCredentials);

  const display = new PhaseTable<"run">([...INIT_STEPS], {
    phases: ["run"] as const,
    phaseLabels: { run: "running" },
    header: "ix · local · init-cluster",
  });
  display.start();

  let clusterIp = "";

  const run = async (step: InitStep, fn: () => Promise<void>) => {
    display.transition(step, "run", "running");
    try {
      await fn();
      display.transition(step, "run", "done");
    } catch (err) {
      display.transition(step, "run", "failed");
      display.setError(step, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  try {
    // Step 1: create kind cluster if absent (FR-007-AC-2)
    await run("kind cluster", async () => {
      try {
        const { stdout } = await execa("kind", ["get", "clusters"]);
        if (
          stdout
            .split("\n")
            .map((s) => s.trim())
            .includes(config.kindClusterName)
        ) {
          return; // idempotent — already exists
        }
      } catch (err: unknown) {
        // FR-007-AC-6: kind not in PATH
        if (
          err instanceof Error &&
          (err.message.includes("ENOENT") || err.message.includes("not found"))
        ) {
          throw new Error(
            "kind is not installed or not in PATH. Install it from https://kind.sigs.k8s.io/docs/user/quick-start/#installation",
          );
        }
        throw err;
      }
      try {
        await execa(
          "kind",
          ["create", "cluster", "--name", config.kindClusterName],
          { all: true },
        );
      } catch {
        throw new Error(
          `Failed to create kind cluster '${config.kindClusterName}'.`,
        );
      }
    });

    // Step 2: install cert-manager
    await run("cert-manager", async () => {
      await execa(
        "kubectl",
        ["apply", "-f", CERT_MANAGER_URL(config.certManagerVersion)],
        { all: true },
      );
      for (const dep of [
        "cert-manager",
        "cert-manager-cainjector",
        "cert-manager-webhook",
      ]) {
        try {
          await execa(
            "kubectl",
            [
              "rollout",
              "status",
              `deployment/${dep}`,
              "-n",
              "cert-manager",
              `--timeout=${config.certManagerTimeoutSeconds}s`,
            ],
            { all: true },
          );
        } catch {
          throw new Error(
            `Deployment ${dep} did not become Ready within ${config.certManagerTimeoutSeconds}s. ` +
              `Run: kubectl describe deployment/${dep} -n cert-manager`,
          );
        }
      }
    });

    // Step 3: apply ix-ca-issuer manifests
    await run("ca-issuer", async () => {
      await execa("kubectl", ["apply", "-f", "-"], {
        input: IX_CA_ISSUER_YAML,
        all: true,
      });
    });

    // Step 4: issue wildcard TLS certificate (FR-007-AC-3)
    await run("wildcard cert", async () => {
      await execa("kubectl", ["apply", "-f", "-"], {
        input: wildcardCertYaml(config.internalBaseDomain),
        all: true,
      });
    });

    // Step 5: wait for certificate Ready (FR-007-AC-9)
    await run("wait cert", async () => {
      // H5: monotonic deadline, clamped sleep so loop never overruns timeout.
      const POLL_MS = 5000;
      const timeoutMs = config.certWaitTimeoutSeconds * 1000;
      const startNs = process.hrtime.bigint();
      const elapsedMs = () =>
        Number((process.hrtime.bigint() - startNs) / 1_000_000n);

      while (elapsedMs() < timeoutMs) {
        try {
          const { stdout } = await execa("kubectl", [
            "get",
            "certificate",
            "ix-dev-wildcard-cert",
            "-n",
            "default",
            "-o",
            "jsonpath={.status.conditions[?(@.type=='Ready')].status}",
          ]);
          if (stdout.trim() === "True") return;
        } catch {
          // cert not yet created, keep polling
        }
        const remaining = timeoutMs - elapsedMs();
        if (remaining <= 0) break;
        await new Promise((r) => setTimeout(r, Math.min(POLL_MS, remaining)));
      }
      throw new Error(
        `Wildcard certificate did not become Ready within ${config.certWaitTimeoutSeconds}s. ` +
          `Run: kubectl describe certificate ix-dev-wildcard-cert -n default`,
      );
    });

    // Step 6: create ghcr-credentials imagePullSecret
    // C2: token piped via stdin in a Secret manifest, never on argv.
    await run("ghcr secret", async () => {
      await execa("kubectl", ["apply", "-f", "-"], {
        input: buildGhcrSecretManifest(ghcrToken),
        all: true,
      });
    });

    // Step 7: create npm-proxy-github Secret for Verdaccio → GitHub Packages
    await run("npm secret", async () => {
      const encoded = Buffer.from(ghcrToken).toString("base64");
      const manifest = [
        "apiVersion: v1",
        "kind: Secret",
        "metadata:",
        "  name: npm-proxy-github",
        "  namespace: default",
        "type: Opaque",
        "data:",
        `  GH_TOKEN: ${encoded}`,
        "",
      ].join("\n");
      await execa("kubectl", ["apply", "-f", "-"], {
        input: manifest,
        all: true,
      });
    });

    // Step 8: collect DNS info (FR-007-AC-5)
    await run("dns config", async () => {
      const { stdout } = await execa("kubectl", [
        "get",
        "nodes",
        "-o",
        "jsonpath={range .items[*]}{range .status.addresses[?(@.type=='InternalIP')]}{.address}{'\\n'}{end}{end}",
      ]);
      // M4: take the first non-empty InternalIP line
      clusterIp =
        stdout
          .split("\n")
          .map((s) => s.trim())
          .find((s) => s.length > 0) ?? "";
    });

    const dnsTail = clusterIp
      ? `DNS: add  address=/.${config.internalBaseDomain}/${clusterIp}  to /etc/dnsmasq.conf`
      : undefined;
    display.finish(null, undefined, dnsTail);
  } catch (err) {
    display.finish(null);
    throw err;
  }
}
