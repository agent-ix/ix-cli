/**
 * FR-044 — `ix local auth kubeconfig issue`
 *
 * Emits an operator-scoped kubeconfig backed by the
 * `system:serviceaccount:system:ix-cli-admin` ServiceAccount provisioned by
 * identity FR-034. The emitted kubeconfig carries the long-lived SA token
 * stored in `Secret system/ix-cli-admin-token` and is the canonical artifact
 * an operator switches to after `ix local init` finishes.
 *
 * Per FR-044-CON-1, this command SHALL NOT issue any HTTP/HTTPS/WebSocket/gRPC
 * call to identity, auth-service, or any other ix service. The only outbound
 * verbs are read-only `kubectl get` / `kubectl config view`.
 *
 * Per FR-044-CON-3, the decoded SA token SHALL NOT appear in stdout, stderr,
 * log files, telemetry, audit records, process argv, or environment variables.
 * The token transits process memory only between base64 decode and YAML
 * serialize + atomic write.
 */

import path from "node:path";
import fsPromises from "node:fs/promises";
import { execa, type ExecaError } from "execa";
import { stringify as stringifyYaml } from "yaml";
import { FlowLine, Info, blue } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";
import { IX_SYSTEM_NAMESPACE } from "./auth-identity.js";
import { runWithLiveListing } from "../live-listing-runner.js";

const HEADER = "ix local auth kubeconfig issue";
const SA_TOKEN_SECRET = "ix-cli-admin-token";
const SA_USER_NAME = "ix-cli-admin";
const DEFAULT_CLUSTER_NAME = "ix-local";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthKubeconfigIssueOptions {
  outputPath: string;
  contextName: string;
  force: boolean;
}

export interface ClusterBlock {
  server: string;
  "certificate-authority-data"?: string;
  "certificate-authority"?: string;
  "insecure-skip-tls-verify"?: boolean;
}

export interface KubeconfigSecretData {
  /** Base64-encoded token from Secret .data.token. */
  tokenB64: string;
}

interface WriteFileOptions {
  mode?: number;
}

export interface AuthKubeconfigIssueDeps {
  /** Returns the active kubeconfig's first cluster block + its name. */
  kubectlConfigView?: () => Promise<{
    name: string;
    cluster: ClusterBlock;
  }>;
  /** Returns the SA token Secret payload (data field). */
  kubectlGetSecret?: (
    namespace: string,
    name: string,
  ) => Promise<KubeconfigSecretData>;
  /** Filesystem ops. Mirrors fs/promises so tests can mock. */
  pathExists?: (p: string) => Promise<boolean>;
  writeFile?: (
    p: string,
    data: string,
    opts?: WriteFileOptions,
  ) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  chmod?: (p: string, mode: number) => Promise<void>;
  unlink?: (p: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class KubeconfigIssueError extends Error {
  readonly code:
    | "secret_not_found"
    | "secret_forbidden"
    | "output_exists"
    | "kubectl_unavailable"
    | "cluster_unreadable"
    | "invalid_token";
  constructor(code: KubeconfigIssueError["code"], message: string) {
    super(message);
    this.name = "KubeconfigIssueError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Default kubectl deps
// ---------------------------------------------------------------------------

function asString(x: unknown): string {
  if (typeof x === "string") return x;
  if (x === undefined || x === null) return "";
  if (x instanceof Uint8Array) return Buffer.from(x).toString("utf-8");
  return String(x);
}

async function defaultKubectlConfigView(): Promise<{
  name: string;
  cluster: ClusterBlock;
}> {
  let result;
  try {
    result = await execa(
      "kubectl",
      ["config", "view", "--raw", "--minify", "-o", "json"],
      { all: false },
    );
  } catch (err) {
    const e = err as ExecaError;
    const stderr = asString(e.stderr);
    if (
      e.code === "ENOENT" ||
      /command not found|not found/i.test(asString(e.shortMessage))
    ) {
      throw new KubeconfigIssueError(
        "kubectl_unavailable",
        "kubectl binary not on PATH",
      );
    }
    throw new KubeconfigIssueError(
      "cluster_unreadable",
      `kubectl config view failed: ${stderr || e.shortMessage || e.message}`,
    );
  }
  let parsed: {
    clusters?: { name?: string; cluster?: ClusterBlock }[];
  };
  try {
    parsed = JSON.parse(asString(result.stdout));
  } catch (parseErr) {
    throw new KubeconfigIssueError(
      "cluster_unreadable",
      `kubectl config view returned unparseable JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
    );
  }
  const entry = parsed.clusters?.[0];
  if (!entry || !entry.cluster || !entry.cluster.server) {
    throw new KubeconfigIssueError(
      "cluster_unreadable",
      "Could not read the active kubeconfig's cluster block. Ensure KUBECONFIG points at a working cluster-admin kubeconfig.",
    );
  }
  return {
    name: entry.name ?? DEFAULT_CLUSTER_NAME,
    cluster: entry.cluster,
  };
}

async function defaultKubectlGetSecret(
  namespace: string,
  name: string,
): Promise<KubeconfigSecretData> {
  let result;
  try {
    result = await execa(
      "kubectl",
      ["get", "secret", "-n", namespace, name, "-o", "json"],
      { all: false },
    );
  } catch (err) {
    const e = err as ExecaError;
    const stderr = asString(e.stderr);
    if (
      e.code === "ENOENT" ||
      /command not found/i.test(asString(e.shortMessage))
    ) {
      throw new KubeconfigIssueError(
        "kubectl_unavailable",
        "kubectl binary not on PATH",
      );
    }
    if (/notfound|not found/i.test(stderr)) {
      throw new KubeconfigIssueError(
        "secret_not_found",
        "ix-cli admin ServiceAccount token Secret is missing. The identity Helm chart predates FR-034, or `ix local up` is incomplete. Run `ix local up` and retry.",
      );
    }
    if (/forbidden/i.test(stderr)) {
      throw new KubeconfigIssueError(
        "secret_forbidden",
        "Caller cannot read `system/ix-cli-admin-token`. Re-run from a kubeconfig with `get` on that Secret (typically cluster-admin during bootstrap).",
      );
    }
    throw new KubeconfigIssueError(
      "cluster_unreadable",
      `kubectl get secret failed: ${stderr || e.shortMessage || e.message}`,
    );
  }
  let parsed: { data?: Record<string, string> };
  try {
    parsed = JSON.parse(asString(result.stdout));
  } catch (parseErr) {
    throw new KubeconfigIssueError(
      "cluster_unreadable",
      `kubectl get secret returned unparseable JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
    );
  }
  const tokenB64 = parsed.data?.token;
  if (!tokenB64) {
    throw new KubeconfigIssueError(
      "invalid_token",
      "Secret system/ix-cli-admin-token has no .data.token field",
    );
  }
  return { tokenB64 };
}

async function defaultPathExists(p: string): Promise<boolean> {
  try {
    await fsPromises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function defaultWriteFile(
  p: string,
  data: string,
  opts?: WriteFileOptions,
): Promise<void> {
  await fsPromises.writeFile(p, data, { mode: opts?.mode });
}

// ---------------------------------------------------------------------------
// Pure helpers (testable in isolation)
// ---------------------------------------------------------------------------

/** Decode the SA token Secret payload. Throws on invalid base64. */
export function decodeTokenB64(b64: string): string {
  // Buffer.from with "base64" silently tolerates garbage. To catch invalid
  // base64 strictly per FR-044-CON-4, round-trip and compare.
  const trimmed = b64.trim();
  if (trimmed === "") {
    throw new KubeconfigIssueError(
      "invalid_token",
      "Secret system/ix-cli-admin-token contains an empty token",
    );
  }
  // Strict base64 alphabet check (RFC 4648 §4). Node's Buffer.from(..., "base64")
  // silently strips invalid characters, so we MUST validate the input shape
  // before decoding — otherwise a garbage Secret could decode to a non-empty
  // string that gets written to the kubeconfig (FR-044-CON-4 forbids this).
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed.replace(/\s+/g, ""))) {
    throw new KubeconfigIssueError(
      "invalid_token",
      "Secret system/ix-cli-admin-token .data.token is not valid base64",
    );
  }
  const buf = Buffer.from(trimmed, "base64");
  const decoded = buf.toString("utf-8");
  if (decoded === "") {
    throw new KubeconfigIssueError(
      "invalid_token",
      "Secret system/ix-cli-admin-token decoded to an empty token",
    );
  }
  return decoded;
}

export function buildKubeconfigYaml(args: {
  cluster: ClusterBlock;
  clusterName: string;
  contextName: string;
  token: string;
}): string {
  const doc = {
    apiVersion: "v1",
    kind: "Config",
    clusters: [
      {
        name: args.clusterName,
        cluster: args.cluster,
      },
    ],
    users: [
      {
        name: SA_USER_NAME,
        user: {
          token: args.token,
        },
      },
    ],
    contexts: [
      {
        name: args.contextName,
        context: {
          cluster: args.clusterName,
          user: SA_USER_NAME,
        },
      },
    ],
    "current-context": args.contextName,
  };
  return stringifyYaml(doc);
}

// ---------------------------------------------------------------------------
// Public runner
// ---------------------------------------------------------------------------

export async function runAuthKubeconfigIssue(
  config: IxConfig,
  opts: AuthKubeconfigIssueOptions,
  deps?: AuthKubeconfigIssueDeps,
): Promise<void> {
  void config;
  const _configView = deps?.kubectlConfigView ?? defaultKubectlConfigView;
  const _getSecret = deps?.kubectlGetSecret ?? defaultKubectlGetSecret;
  const _pathExists = deps?.pathExists ?? defaultPathExists;
  const _writeFile = deps?.writeFile ?? defaultWriteFile;
  const _rename = deps?.rename ?? fsPromises.rename;
  const _chmod = deps?.chmod ?? fsPromises.chmod;
  const _unlink = deps?.unlink ?? fsPromises.unlink;

  await runWithLiveListing<{ outputPath: string }>({
    header: HEADER,
    pre: (
      <FlowLine>{`Issuing operator-scoped kubeconfig from ${blue(IX_SYSTEM_NAMESPACE)}/${blue(SA_TOKEN_SECRET)}`}</FlowLine>
    ),
    controller: async () => {
      const outputPath = path.resolve(opts.outputPath);

      // Step 4 (refuse pre-existing): perform this before any kubectl call
      // so we fail fast and never read the Secret unnecessarily.
      if (!opts.force && (await _pathExists(outputPath))) {
        throw new KubeconfigIssueError(
          "output_exists",
          `Refusing to overwrite existing file \`${outputPath}\`. Pass --force to overwrite, or remove the file.`,
        );
      }

      // Step 1: cluster info from active kubeconfig.
      const { name: clusterName, cluster } = await _configView();

      // Step 2 + 3: SA token Secret + base64-decode in memory.
      const { tokenB64 } = await _getSecret(
        IX_SYSTEM_NAMESPACE,
        SA_TOKEN_SECRET,
      );
      const token = decodeTokenB64(tokenB64);

      // Step 5: assemble kubeconfig YAML.
      const yaml = buildKubeconfigYaml({
        cluster,
        clusterName: clusterName || DEFAULT_CLUSTER_NAME,
        contextName: opts.contextName,
        token,
      });

      // Step 6: atomic write — tempfile + chmod 600 + rename.
      const dir = path.dirname(outputPath);
      const base = path.basename(outputPath);
      const tempPath = path.join(dir, `.${base}.tmp-${process.pid}`);
      try {
        await _writeFile(tempPath, yaml, { mode: 0o600 });
        // Belt-and-suspenders chmod (some filesystems / mocks ignore the
        // open-mode flag); FR-044-CON-2 requires 0600 after write.
        await _chmod(tempPath, 0o600);
        await _rename(tempPath, outputPath);
      } catch (err) {
        // Best-effort cleanup; never surface unlink errors over the real one.
        try {
          await _unlink(tempPath);
        } catch {
          /* ignore */
        }
        throw err;
      }

      return { outputPath };
    },
    frameForSuccess: ({ outputPath }) => ({
      tail: `Wrote operator-scoped kubeconfig to ${blue(outputPath)}. Switch with: export KUBECONFIG=${outputPath}`,
      children: [
        <Info key="path" name="Output" description={blue(outputPath)} />,
        <Info
          key="user"
          name="User"
          description={`system:serviceaccount:${IX_SYSTEM_NAMESPACE}:${SA_USER_NAME}`}
        />,
      ],
    }),
    frameForError: (err) => ({
      status: "failed",
      tail: `auth kubeconfig issue failed: ${err.message}`,
      tailVariant: "error",
    }),
  });
}
