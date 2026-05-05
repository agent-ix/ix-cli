import fs from "node:fs";
import { execa } from "execa";
import type { ServiceRow } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "./config.js";
import {
  IX_APPS_NAMESPACE,
  IX_AUTH_NAMESPACE,
  IX_PLATFORM_NAMESPACE,
  IX_SYSTEM_NAMESPACE,
} from "./config.js";
import {
  resolveCatalog,
  HOST_MOUNT_CATALOG,
  type ResolvedHostMount,
} from "./host-mounts.js";
import { PhaseRows, createPhaseRows } from "./phase-rows.js";

export function buildKindConfig(
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
  const pollMs = 2000;
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
      if (
        !/connection refused|no endpoints available|EOF|x509|tls/i.test(lastErr)
      ) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `ingress-nginx admission webhook did not become ready within ${timeoutSeconds}s. ` +
      `Last error: ${lastErr.slice(0, 200)}`,
  );
}

export const INIT_STEPS = [
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

export type InitStep = (typeof INIT_STEPS)[number];
export type InitPhase = "run";
export const INIT_PHASES: readonly InitPhase[] = ["run"];
export const INIT_PHASE_LABELS: Record<InitPhase, string> = {
  run: "running",
};

export interface InitClusterResult {
  clusterIp: string;
}

export function initialInitRows(): ServiceRow<InitPhase>[] {
  return createPhaseRows(
    INIT_STEPS.map((name) => ({ name })),
    INIT_PHASES,
  );
}

export async function runInitClusterController(
  config: IxConfig,
  emit: (services: ServiceRow<InitPhase>[]) => void,
): Promise<InitClusterResult> {
  const rows = new PhaseRows(
    INIT_STEPS.map((name) => ({ name })),
    INIT_PHASES,
    emit,
  );
  let clusterIp = "";

  const run = async (step: InitStep, fn: () => Promise<void>) => {
    rows.setPhase(step, "run", "running");
    try {
      await fn();
      rows.setPhase(step, "run", "done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.setError(step, "run", msg);
      throw err;
    }
  };

  await run("kind cluster", async () => {
    let alreadyExists = false;
    try {
      const { stdout } = await execa("kind", ["get", "clusters"]);
      alreadyExists = stdout
        .split("\n")
        .map((s) => s.trim())
        .includes(config.kindClusterName);
    } catch (err: unknown) {
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
    await execa("kind", [
      "export",
      "kubeconfig",
      "--name",
      config.kindClusterName,
    ]);
  });

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

  await run("ca-issuer", async () => {
    await execa("kubectl", ["apply", "-f", "-"], {
      input: IX_CA_ISSUER_YAML,
      all: true,
    });
  });

  await run("ingress-nginx", async () => {
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
    await waitAdmissionWebhookReady(config.ingressNginxTimeoutSeconds);
  });

  await run("wildcard cert", async () => {
    await execa("kubectl", ["apply", "-f", "-"], {
      input: wildcardCertYaml(config.hosts),
      all: true,
    });
  });

  await run("ingress tls", async () => {
    await execa("kubectl", ["apply", "-f", "-"], {
      input: ingressTlsCertYaml(config.hosts),
      all: true,
    });

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

  await run("wait cert", async () => {
    const targets: { name: string; ns: string }[] = [
      { name: "ix-dev-wildcard-cert", ns: "default" },
      { name: "ix-tls", ns: "ingress-nginx" },
    ];

    const pollMs = 5000;
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
          // Certificate is not ready or not created yet.
        }
      }
      if (pending.size === 0) return;
      const remaining = timeoutMs - elapsedMs();
      if (remaining <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining)));
    }
    const missing = [...pending].join(", ");
    throw new Error(
      `Certificate(s) did not become Ready within ${config.certWaitTimeoutSeconds}s: ${missing}. ` +
        `Run: kubectl describe certificate -A`,
    );
  });

  await run("namespaces + rbac", async () => {
    await execa("kubectl", ["apply", "-f", "-"], {
      input: NAMESPACE_AND_RBAC_YAML,
      all: true,
    });
  });

  await run("dns config", async () => {
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
  });

  return { clusterIp };
}
