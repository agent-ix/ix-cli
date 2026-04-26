/**
 * FR-007 — init-cluster Command
 * Full cluster bootstrap: kind create, cert-manager, ix-ca-issuer, wildcard TLS,
 * GHCR credentials, DNS instructions. Idempotent (FR-007-AC-1).
 */

import { execa } from "execa";
import { Listr } from "listr2";
import pc from "picocolors";
import * as p from "@clack/prompts";
import type { IxConfig } from "../config.js";
import { resolveGhcrToken } from "../credentials.js";

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

// Cert-manager manifest URL is constructed from the version in config
const CERT_MANAGER_URL = (version: string) =>
  `https://github.com/jetstack/cert-manager/releases/download/${version}/cert-manager.yaml`;

// ix-ca-issuer manifest applied inline
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

async function streamOutput(
  cmd: string,
  args: string[],
  opts: object,
  task: { output: string },
): Promise<void> {
  const subprocess = execa(cmd, args, { ...opts, all: true });
  subprocess.all?.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (line) task.output = line;
  });
  await subprocess;
}

export async function runInitCluster(
  config: IxConfig,
  reconfigureCredentials: boolean,
): Promise<void> {
  p.intro(pc.bgCyan(pc.black(` ix-local init-cluster `)));

  // Resolve credentials before entering the Listr task list — clack's
  // interactive prompt needs direct terminal access and is swallowed by
  // Listr's renderer.  resolveGhcrToken returns immediately when a token
  // is already stored (env var or credentials file).
  const ghcrToken = await resolveGhcrToken(reconfigureCredentials);

  const tasks = new Listr(
    [
      // Step 1: create kind cluster if absent (FR-007-AC-2)
      {
        title: "Create kind cluster",
        task: async (ctx, task) => {
          // Check if cluster already exists (idempotency FR-007-AC-1)
          try {
            const { stdout } = await execa("kind", ["get", "clusters"]);
            if (
              stdout
                .split("\n")
                .map((s) => s.trim())
                .includes(config.kindClusterName)
            ) {
              task.skip(`Cluster '${config.kindClusterName}' already exists`);
              return;
            }
          } catch (err: unknown) {
            // FR-007-AC-6: kind not in PATH
            if (
              err instanceof Error &&
              (err.message.includes("ENOENT") ||
                err.message.includes("not found"))
            ) {
              throw new Error(
                "kind is not installed or not in PATH. Install it from https://kind.sigs.k8s.io/docs/user/quick-start/#installation",
              );
            }
            throw err;
          }

          // FR-007-AC-47: kind create failure
          try {
            await streamOutput(
              "kind",
              ["create", "cluster", "--name", config.kindClusterName],
              {},
              task,
            );
          } catch {
            throw new Error(
              `Failed to create kind cluster '${config.kindClusterName}'. Check kind logs above.`,
            );
          }
        },
      },

      // Step 2: install cert-manager
      {
        title: `Install cert-manager ${config.certManagerVersion}`,
        task: async (ctx, task) => {
          await streamOutput(
            "kubectl",
            ["apply", "-f", CERT_MANAGER_URL(config.certManagerVersion)],
            {},
            task,
          );

          // Wait for cert-manager deployments (FR-007-AC-8)
          const deployments = [
            "cert-manager",
            "cert-manager-cainjector",
            "cert-manager-webhook",
          ];
          for (const dep of deployments) {
            try {
              await streamOutput(
                "kubectl",
                [
                  "rollout",
                  "status",
                  `deployment/${dep}`,
                  "-n",
                  "cert-manager",
                  `--timeout=${config.certManagerTimeoutSeconds}s`,
                ],
                {},
                task,
              );
            } catch {
              throw new Error(
                `Deployment ${dep} did not become Ready within ${config.certManagerTimeoutSeconds}s. ` +
                  `Run: kubectl describe deployment/${dep} -n cert-manager`,
              );
            }
          }
        },
      },

      // Step 3: apply ix-ca-issuer manifests
      {
        title: "Apply ix-ca-issuer",
        task: async (ctx, task) => {
          const subprocess = execa("kubectl", ["apply", "-f", "-"], {
            input: IX_CA_ISSUER_YAML,
            all: true,
          });
          subprocess.all?.on("data", (chunk) => {
            const line = chunk.toString().trim();
            if (line) task.output = line;
          });
          await subprocess;
        },
      },

      // Step 4: issue wildcard TLS certificate (FR-007-AC-3)
      {
        title: `Issue wildcard cert for *.${config.internalBaseDomain}`,
        task: async (ctx, task) => {
          const manifest = wildcardCertYaml(config.internalBaseDomain);
          const subprocess = execa("kubectl", ["apply", "-f", "-"], {
            input: manifest,
            all: true,
          });
          subprocess.all?.on("data", (chunk) => {
            const line = chunk.toString().trim();
            if (line) task.output = line;
          });
          await subprocess;
        },
      },

      // Step 5: wait for certificate Ready (FR-007-AC-9)
      {
        title: "Wait for wildcard certificate",
        task: async (ctx, task) => {
          // H5: monotonic deadline (process.hrtime.bigint, not Date.now)
          // and clamped sleep so the loop never overruns the user's timeout.
          const POLL_INTERVAL_MS = 5000;
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
              if (stdout.trim() === "True") {
                task.output = "Certificate is Ready";
                return;
              }
            } catch {
              // cert not yet created, keep polling
            }
            task.output = "Waiting for certificate…";
            const remaining = timeoutMs - elapsedMs();
            if (remaining <= 0) break;
            await new Promise((r) =>
              setTimeout(r, Math.min(POLL_INTERVAL_MS, remaining)),
            );
          }
          throw new Error(
            `Wildcard certificate did not become Ready within ${config.certWaitTimeoutSeconds}s. ` +
              `Run: kubectl describe certificate ix-dev-wildcard-cert -n default`,
          );
        },
      },

      // Step 6: create ghcr-credentials imagePullSecret
      // C2: token is piped via stdin in a Secret manifest, never on argv.
      {
        title: "Create GHCR imagePullSecret",
        task: async (ctx, task) => {
          const manifest = buildGhcrSecretManifest(ghcrToken);

          const subprocess = execa("kubectl", ["apply", "-f", "-"], {
            input: manifest,
            all: true,
          });
          subprocess.all?.on("data", (chunk) => {
            const line = chunk.toString().trim();
            if (line) task.output = line;
          });
          await subprocess;
        },
      },

      // Step 7b: create npm-proxy-github Secret so Verdaccio can proxy
      // @agent-ix/* packages from GitHub Packages (requires read:packages PAT,
      // same token we already resolved for GHCR).
      {
        title: "Create npm-proxy-github secret",
        task: async (ctx, task) => {
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
          const subprocess = execa("kubectl", ["apply", "-f", "-"], {
            input: manifest,
            all: true,
          });
          subprocess.all?.on("data", (chunk) => {
            const line = chunk.toString().trim();
            if (line) task.output = line;
          });
          await subprocess;
        },
      },

      // Step 8: print DNS instructions (FR-007-AC-5)
      {
        title: "Print DNS configuration",
        task: async (ctx, task) => {
          const { stdout } = await execa("kubectl", [
            "get",
            "nodes",
            "-o",
            "jsonpath={range .items[*]}{range .status.addresses[?(@.type=='InternalIP')]}{.address}{'\\n'}{end}{end}",
          ]);
          // M4: jsonpath returns one InternalIP per line. Take the first
          // non-empty line — multi-node kind clusters previously joined IPs
          // into a single space-separated string and broke the dnsmasq output.
          const clusterIp =
            stdout
              .split("\n")
              .map((s) => s.trim())
              .find((s) => s.length > 0) ?? "";
          task.output = [
            `Cluster IP: ${clusterIp}`,
            `Add to /etc/dnsmasq.conf:  address=/.${config.internalBaseDomain}/${clusterIp}`,
          ].join("\n");
        },
      },
    ],
    {
      concurrent: false,
      rendererOptions: { collapseSubtasks: false },
    },
  );

  let clusterIp = "";
  try {
    await tasks.run();

    // Collect cluster IP for outro (M4: take first node's first InternalIP)
    try {
      const { stdout } = await execa("kubectl", [
        "get",
        "nodes",
        "-o",
        "jsonpath={range .items[*]}{range .status.addresses[?(@.type=='InternalIP')]}{.address}{'\\n'}{end}{end}",
      ]);
      clusterIp =
        stdout
          .split("\n")
          .map((s) => s.trim())
          .find((s) => s.length > 0) ?? "";
    } catch {
      // best-effort
    }

    p.outro(
      pc.green(
        [
          "Cluster ready.",
          `  Wildcard TLS secret: ix-dev-wildcard-tls (default namespace)`,
          `  Domain: *.${config.internalBaseDomain}`,
          clusterIp
            ? `  DNS: add  address=/.${config.internalBaseDomain}/${clusterIp}  to /etc/dnsmasq.conf`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  } catch (err) {
    p.outro(
      pc.red(
        `init-cluster failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    throw err;
  }
}
