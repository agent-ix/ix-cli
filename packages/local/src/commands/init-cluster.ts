/**
 * FR-007 — init-cluster Command
 * Full cluster bootstrap: kind create, cert-manager, ix-ca-issuer, ingress-nginx,
 * wildcard TLS (per-app + ingress default), DNS instructions. Idempotent
 * (FR-007-AC-1).
 *
 * Image-pull / registry credentials are NOT created here. Each service that
 * needs them declares the Secret in its own ix-local.secrets.yaml; the
 * standard secret-contract path (local-secrets.ts) materializes them in the
 * service's namespace during `ix local up`.
 */

import fs from "node:fs";
import { execa } from "execa";
import type { IxConfig } from "../config.js";
import {
  IX_APPS_NAMESPACE,
  IX_AUTH_NAMESPACE,
  IX_PLATFORM_NAMESPACE,
  IX_SYSTEM_NAMESPACE,
} from "../config.js";
import { PhaseTable } from "@agent-ix/ix-ui-cli";
import {
  resolveCatalog,
  HOST_MOUNT_CATALOG,
  type ResolvedHostMount,
} from "../host-mounts.js";

function buildKindConfig(
  clusterName: string,
  mounts: ResolvedHostMount[],
): string {
  const mountLines = mounts
    .filter((m) => m.source.type === "hostPath")
    .flatMap((m) => {
      const src = m.source as {
        type: "hostPath";
        path: string;
        hostPathType?: string;
      };
      // kind extraMounts don't support hostPathType — pre-create DirectoryOrCreate paths
      if (src.hostPathType === "DirectoryOrCreate") {
        fs.mkdirSync(src.path, { recursive: true });
      }
      return [
        `      - hostPath: ${src.path}`,
        `        containerPath: ${m.containerPath}`,
      ];
    });

  return [
    "kind: Cluster",
    "apiVersion: kind.x-k8s.io/v1alpha4",
    `name: ${clusterName}`,
    "networking:",
    '  apiServerAddress: "127.0.0.1"',
    "nodes:",
    "  - role: control-plane",
    "    extraPortMappings:",
    "      - containerPort: 80",
    "        hostPort: 80",
    "        protocol: TCP",
    "      - containerPort: 443",
    "        hostPort: 443",
    "        protocol: TCP",
    "    kubeadmConfigPatches:",
    "      - |",
    "        kind: InitConfiguration",
    "        nodeRegistration:",
    "          kubeletExtraArgs:",
    '            node-labels: "ingress-ready=true"',
    "    extraMounts:",
    ...mountLines,
    "",
  ].join("\n");
}

/**
 * NFR-003 — four-tier namespace contract + identity → admin-bootstrap RBAC.
 *
 * Creates the four namespaces (system / auth / platform / apps) and grants
 * the identity ServiceAccount (in `auth`) a narrow `delete`-only
 * Role + RoleBinding scoped to `secrets/admin-bootstrap` in `system`. This
 * is what makes identity FR-019-AC-4 / FR-019-CON-3 work in production:
 * without it, identity's best-effort delete on rotation gets HTTP 403 from
 * the API server.
 *
 * The Role is intentionally `delete`-only — no `get`/`list`/`watch`/`create`/
 * `update`. A compromised auth-namespace pod still cannot read or modify
 * the bootstrap Secret; it can only delete the one named entry.
 */
const NAMESPACE_AND_RBAC_YAML = `
apiVersion: v1
kind: Namespace
metadata:
  name: ${IX_SYSTEM_NAMESPACE}
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${IX_AUTH_NAMESPACE}
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${IX_PLATFORM_NAMESPACE}
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${IX_APPS_NAMESPACE}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: identity
  namespace: ${IX_AUTH_NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: identity-delete-admin-bootstrap
  namespace: ${IX_SYSTEM_NAMESPACE}
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["admin-bootstrap"]
    verbs: ["delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: identity-delete-admin-bootstrap
  namespace: ${IX_SYSTEM_NAMESPACE}
subjects:
  - kind: ServiceAccount
    name: identity
    namespace: ${IX_AUTH_NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: identity-delete-admin-bootstrap
---
# NFR-003-CON-4 / NetworkPolicy table: deny all pod ingress to the system
# namespace as belt-and-suspenders. The system namespace is operator-only;
# no pods are deployed here. If anything ever lands in system by accident,
# it cannot be reached from in-cluster traffic.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: system-deny-all-ingress
  namespace: ${IX_SYSTEM_NAMESPACE}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress: []
`;

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

function wildcardCertYaml(hosts: string[]): string {
  const sans = hosts.map((h) => `    - "*.${h}"`).join("\n");
  return `
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: ix-dev-wildcard-cert
  namespace: default
spec:
  secretName: ix-dev-wildcard-tls
  dnsNames:
${sans}
  issuerRef:
    name: ix-local-issuer
    kind: ClusterIssuer
    group: cert-manager.io
`.trim();
}

const INGRESS_NGINX_URL = (version: string) =>
  `https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-${version}/deploy/static/provider/kind/deploy.yaml`;

/**
 * Default-SSL Certificate for the ingress-nginx controller. Issued by the
 * ix-local-issuer (CA chain established in step 3) and consumed via the
 * controller's --default-ssl-certificate flag so any HTTPS request to
 * *.<host> for any configured host gets a trusted cert without per-Ingress
 * TLS blocks.
 */
function ingressTlsCertYaml(hosts: string[]): string {
  const sans = hosts.map((h) => `    - "*.${h}"`).join("\n");
  return `
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: ix-tls
  namespace: ingress-nginx
spec:
  secretName: ix-tls
  dnsNames:
${sans}
  issuerRef:
    name: ix-local-issuer
    kind: ClusterIssuer
    group: cert-manager.io
`.trim();
}

// Probe Ingress used to verify the validating admission webhook actually
// answers. Server-side dry-run routes through the apiserver → webhook path,
// matching what helm install will hit. "connection refused" means keep
// waiting; any other response (success or validation rejection) means the
// webhook process is bound to :8443.
const WEBHOOK_PROBE_INGRESS = `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ix-init-webhook-probe
  namespace: default
spec:
  ingressClassName: nginx
  rules:
    - host: ix-init-webhook-probe.invalid
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: nonexistent
                port:
                  number: 80
`;

async function waitAdmissionWebhookReady(
  timeoutSeconds: number,
): Promise<void> {
  const POLL_MS = 2000;
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      await execa("kubectl", ["apply", "--dry-run=server", "-f", "-"], {
        input: WEBHOOK_PROBE_INGRESS,
        all: true,
      });
      return;
    } catch (e) {
      lastErr = (e as { all?: string; message?: string }).all ?? String(e);
      // "connection refused" / "no endpoints available" → webhook still
      // coming up. Anything else (e.g. controller-side validation rejection
      // with our intentionally-bogus probe) also means the webhook answered.
      if (
        !/connection refused|no endpoints available|EOF|x509|tls/i.test(lastErr)
      ) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(
    `ingress-nginx admission webhook did not become ready within ${timeoutSeconds}s. ` +
      `Last error: ${lastErr.slice(0, 200)}`,
  );
}

const INIT_STEPS = [
  "kind cluster",
  "cert-manager",
  "ca-issuer",
  "ingress-nginx",
  "wildcard cert",
  "ingress tls",
  "wait cert",
  "namespaces + rbac",
  "dns config",
] as const;

type InitStep = (typeof INIT_STEPS)[number];

export async function runInitCluster(
  config: IxConfig,
  _reconfigureCredentials: boolean,
): Promise<void> {
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
      let alreadyExists = false;
      try {
        const { stdout } = await execa("kind", ["get", "clusters"]);
        alreadyExists = stdout
          .split("\n")
          .map((s) => s.trim())
          .includes(config.kindClusterName);
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
      if (!alreadyExists) {
        try {
          const mounts = resolveCatalog(HOST_MOUNT_CATALOG);
          const kindConfig = buildKindConfig(config.kindClusterName, mounts);
          await execa("kind", ["create", "cluster", "--config", "-"], {
            input: kindConfig,
            all: true,
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Failed to create kind cluster '${config.kindClusterName}': ${detail}`,
          );
        }
      }
      // Always point kubectl at this cluster — `kind create` does this on
      // creation, but on the idempotent path the user's current context may
      // be unset or pointing elsewhere, which makes subsequent kubectl calls
      // fall back to localhost:8080.
      await execa("kind", [
        "export",
        "kubeconfig",
        "--name",
        config.kindClusterName,
      ]);
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

    // Step 4: install ingress-nginx (singleton controller — pairs with the
    // ingress-ready=true node label and the 80/443 extraPortMappings on the
    // kind node). Apps that ship Ingress resources rely on this controller
    // being present cluster-wide.
    await run("ingress-nginx", async () => {
      // The upstream manifest ships two one-shot Jobs
      // (ingress-nginx-admission-create / -patch) that generate the
      // admission webhook TLS Secret. Job spec.template is immutable, so
      // `kubectl apply` fails on a second init if the Jobs are still
      // around (e.g. partial teardown). Delete them first — they're
      // bootstrap-only; the controller depends on the Secret they produce,
      // not on the Job objects, and re-applying recreates and re-runs them.
      await execa(
        "kubectl",
        [
          "-n",
          "ingress-nginx",
          "delete",
          "job",
          "ingress-nginx-admission-create",
          "ingress-nginx-admission-patch",
          "--ignore-not-found",
        ],
        { all: true, reject: false },
      );
      await execa(
        "kubectl",
        ["apply", "-f", INGRESS_NGINX_URL(config.ingressNginxVersion)],
        { all: true },
      );
      try {
        await execa(
          "kubectl",
          [
            "rollout",
            "status",
            "deployment/ingress-nginx-controller",
            "-n",
            "ingress-nginx",
            `--timeout=${config.ingressNginxTimeoutSeconds}s`,
          ],
          { all: true },
        );
      } catch {
        throw new Error(
          `ingress-nginx-controller did not become Ready within ${config.ingressNginxTimeoutSeconds}s. ` +
            `Run: kubectl describe deployment/ingress-nginx-controller -n ingress-nginx`,
        );
      }

      // Rollout Ready only confirms the controller pod's readiness probe
      // (port 10254) — the validating admission webhook on :8443 can lag.
      // Probe the webhook path the apiserver will actually use.
      await waitAdmissionWebhookReady(config.ingressNginxTimeoutSeconds);
    });

    // Step 5: issue wildcard TLS certificate for default ns (FR-007-AC-3)
    await run("wildcard cert", async () => {
      await execa("kubectl", ["apply", "-f", "-"], {
        input: wildcardCertYaml(config.hosts),
        all: true,
      });
    });

    // Step 6: TLS border for ingress-nginx — issue ix-tls in ingress-nginx ns,
    // wire it to the controller as --default-ssl-certificate so every HTTPS
    // request to *.{domain} terminates with a trusted cert without per-Ingress
    // TLS blocks. Configmap patch disables ssl-redirect/hsts so plain-HTTP
    // *.{domain} hosts (e.g. npm.ix) keep working.
    await run("ingress tls", async () => {
      await execa("kubectl", ["apply", "-f", "-"], {
        input: ingressTlsCertYaml(config.hosts),
        all: true,
      });

      // Append --default-ssl-certificate arg only if not already present
      // (controller pods restart on patch — keep idempotent).
      const { stdout: argsJson } = await execa("kubectl", [
        "get",
        "deployment/ingress-nginx-controller",
        "-n",
        "ingress-nginx",
        "-o",
        "jsonpath={.spec.template.spec.containers[0].args}",
      ]);
      if (!argsJson.includes("--default-ssl-certificate")) {
        await execa(
          "kubectl",
          [
            "patch",
            "deployment/ingress-nginx-controller",
            "-n",
            "ingress-nginx",
            "--type=json",
            "-p",
            JSON.stringify([
              {
                op: "add",
                path: "/spec/template/spec/containers/0/args/-",
                value: "--default-ssl-certificate=ingress-nginx/ix-tls",
              },
            ]),
          ],
          { all: true },
        );
      }

      await execa(
        "kubectl",
        [
          "patch",
          "configmap/ingress-nginx-controller",
          "-n",
          "ingress-nginx",
          "--type=merge",
          "-p",
          JSON.stringify({
            data: { "ssl-redirect": "false", hsts: "false" },
          }),
        ],
        { all: true },
      );

      // The deployment patch above triggers a rolling restart of the
      // controller pod. Wait for the new pod's webhook listener to bind
      // before returning, so subsequent `ix local up` steps don't race the
      // restart and hit "connection refused" on the admission webhook.
      await execa(
        "kubectl",
        [
          "rollout",
          "status",
          "deployment/ingress-nginx-controller",
          "-n",
          "ingress-nginx",
          `--timeout=${config.ingressNginxTimeoutSeconds}s`,
        ],
        { all: true },
      );
      await waitAdmissionWebhookReady(config.ingressNginxTimeoutSeconds);
    });

    // Step 7: wait for both certificates Ready (FR-007-AC-9)
    await run("wait cert", async () => {
      const targets: { name: string; ns: string }[] = [
        { name: "ix-dev-wildcard-cert", ns: "default" },
        { name: "ix-tls", ns: "ingress-nginx" },
      ];

      // H5: monotonic deadline, clamped sleep so loop never overruns timeout.
      const POLL_MS = 5000;
      const timeoutMs = config.certWaitTimeoutSeconds * 1000;
      const startNs = process.hrtime.bigint();
      const elapsedMs = () =>
        Number((process.hrtime.bigint() - startNs) / 1_000_000n);

      const pending = new Set(targets.map((t) => `${t.ns}/${t.name}`));
      while (elapsedMs() < timeoutMs && pending.size > 0) {
        for (const t of targets) {
          const key = `${t.ns}/${t.name}`;
          if (!pending.has(key)) continue;
          try {
            const { stdout } = await execa("kubectl", [
              "get",
              "certificate",
              t.name,
              "-n",
              t.ns,
              "-o",
              "jsonpath={.status.conditions[?(@.type=='Ready')].status}",
            ]);
            if (stdout.trim() === "True") pending.delete(key);
          } catch {
            // cert not yet created, keep polling
          }
        }
        if (pending.size === 0) return;
        const remaining = timeoutMs - elapsedMs();
        if (remaining <= 0) break;
        await new Promise((r) => setTimeout(r, Math.min(POLL_MS, remaining)));
      }
      const missing = [...pending].join(", ");
      throw new Error(
        `Certificate(s) did not become Ready within ${config.certWaitTimeoutSeconds}s: ${missing}. ` +
          `Run: kubectl describe certificate -A`,
      );
    });

    // Step 5b: NFR-003 namespace contract + identity Secret-deletion RBAC
    // (FR-019-AC-4 / FR-019-CON-3).
    await run("namespaces + rbac", async () => {
      await execa("kubectl", ["apply", "-f", "-"], {
        input: NAMESPACE_AND_RBAC_YAML,
        all: true,
      });
    });

    // Step 6: collect DNS info (FR-007-AC-5)
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
      ? `DNS: add  ${config.hosts
          .map((h) => `address=/.${h}/${clusterIp}`)
          .join("  ")}  to /etc/dnsmasq.conf`
      : undefined;
    display.finish(null, undefined, dnsTail);
  } catch (err) {
    display.finish(null);
    throw err;
  }
}
