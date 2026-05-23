/**
 * Shared transport helpers for auth-* commands.
 *
 * Two helpers, two privilege tiers — see ix-cli/spec/functional/local/auth.md
 * and auth/ADR-004.
 *
 *   kubectlExecJson   for `init` and `reset-admin` ONLY.
 *                     Runs `kubectl exec deployment/identity -- <argv>` against the
 *                     identity pod. Captures stdout, parses JSON. The identity pod
 *                     exposes no networked endpoint for these operations
 *                     (auth/FR-008-CON-1, identity/FR-029).
 *
 *   kubectlRaw        for `invite`, `reset-user`, and `auth config` reads.
 *                     Routes a request through the K8s API server's authenticated
 *                     service proxy (`kubectl create --raw …/services/proxy/...`).
 *                     Kubeconfig-gated; never via the public ingress.
 *
 * This file SHALL NOT export `fetch`, `resolveIdentityUrl`, port-forward setup,
 * or any other host-originated HTTP transport for identity. Verified by static
 * grep (TC-080, TC-086).
 */

import { execa, type ExecaError } from "execa";
import {
  IX_SYSTEM_NAMESPACE,
  IX_AUTH_NAMESPACE,
  IX_PLATFORM_NAMESPACE,
  IX_APPS_NAMESPACE,
} from "../config.js";

export {
  IX_SYSTEM_NAMESPACE,
  IX_AUTH_NAMESPACE,
  IX_PLATFORM_NAMESPACE,
  IX_APPS_NAMESPACE,
};

// Normalize execa's stdout/stderr — typed as `string | unknown[] | Uint8Array`
// in @types but in practice always string under the options we use.
function asString(x: unknown): string {
  if (typeof x === "string") return x;
  if (x === undefined || x === null) return "";
  if (x instanceof Uint8Array) return Buffer.from(x).toString("utf-8");
  return String(x);
}

// ---------------------------------------------------------------------------
// kubectlExecJson — the only mechanism for admin-mutating operations.
// ---------------------------------------------------------------------------

export class KubectlExecError extends Error {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
  constructor(
    message: string,
    exitCode: number,
    stdout: string,
    stderr: string,
  ) {
    super(message);
    this.name = "KubectlExecError";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Run a command inside a Kubernetes deployment pod via `kubectl exec` and parse
 * its stdout as a single JSON object.
 *
 * Per identity/FR-029 §4–§5, the in-pod CLI prints a JSON envelope to stdout on
 * success (exit 0) and a JSON error envelope to stderr on failure (exit ≠ 0).
 *
 * Throws `KubectlExecError` on non-zero exit so callers can surface the
 * structured error envelope to the operator verbatim.
 */
export async function kubectlExecJson<T>(
  namespace: string,
  deployment: string,
  argv: string[],
): Promise<T> {
  const args = [
    "exec",
    "-n",
    namespace,
    `deployment/${deployment}`,
    "--",
    ...argv,
  ];
  let result;
  try {
    result = await execa("kubectl", args, { all: false });
  } catch (err) {
    const e = err as ExecaError;
    throw new KubectlExecError(
      e.shortMessage ?? e.message,
      typeof e.exitCode === "number" ? e.exitCode : 1,
      asString(e.stdout),
      asString(e.stderr),
    );
  }
  const stdout = asString(result.stdout).trim();
  const stderr = asString(result.stderr);
  if (stdout === "") {
    throw new KubectlExecError(
      "kubectl exec returned empty stdout",
      0,
      "",
      stderr,
    );
  }
  try {
    return JSON.parse(stdout) as T;
  } catch (parseErr) {
    throw new KubectlExecError(
      `kubectl exec stdout was not valid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      0,
      stdout,
      stderr,
    );
  }
}

// ---------------------------------------------------------------------------
// kubectlRaw — kubeconfig-gated HTTP call to identity's `/internal/*` endpoints.
// ---------------------------------------------------------------------------
//
// Mechanism: `kubectl exec` into the identity pod and use Python's urllib to
// hit `http://localhost:8000<path>` from inside the pod. This is functionally
// equivalent to going through the K8s API server's service proxy (both are
// kubeconfig-gated; neither traverses the public ingress) but works around a
// kubectl(>=1.34) quirk where `kubectl create --raw -f -` JSON-wraps the
// stdin body as a string before forwarding, which Pydantic rejects.
//
// Despite the implementation, the design intent is unchanged:
//   - admin-mutating operations: kubectlExecJson (see above) — runs
//     `python -m identity.cli init-admin/reset-admin` with no HTTP at all.
//   - non-admin operations: kubectlRaw — kubeconfig-gated HTTP to identity's
//     `/internal/*` endpoints, never via public ingress.

export interface KubectlRawResponse<T> {
  status: number;
  body: T;
}

const PROXY_SCRIPT = `
import json
import sys
import urllib.error
import urllib.request

method = sys.argv[1]
path = sys.argv[2]
raw = sys.stdin.buffer.read()
req = urllib.request.Request(
    f"http://localhost:8000{path}",
    data=raw if raw else None,
    method=method,
    headers={"Content-Type": "application/json", "Accept": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=5) as r:
        body = r.read().decode("utf-8")
        print(json.dumps({"status": r.status, "body": json.loads(body) if body else None}))
except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8")
    try:
        parsed = json.loads(body) if body else None
    except Exception:
        parsed = body
    print(json.dumps({"status": e.code, "body": parsed}))
`;

// Generalised script for non-default ports / methods / headers.
const PROXY_SCRIPT_V2 = `
import json
import sys
import urllib.error
import urllib.request

method = sys.argv[1]
path = sys.argv[2]
port = int(sys.argv[3])
headers = json.loads(sys.argv[4])
raw = sys.stdin.buffer.read()
req = urllib.request.Request(
    f"http://localhost:{port}{path}",
    data=raw if raw else None,
    method=method,
    headers=headers,
)
try:
    with urllib.request.urlopen(req, timeout=5) as r:
        body = r.read().decode("utf-8")
        try:
            parsed = json.loads(body) if body else None
        except Exception:
            parsed = body
        print(json.dumps({"status": r.status, "body": parsed}))
except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8")
    try:
        parsed = json.loads(body) if body else None
    except Exception:
        parsed = body
    print(json.dumps({"status": e.code, "body": parsed}))
`;

interface ProxyEnvelope<T> {
  status: number;
  body: T;
}

/**
 * Make a kubeconfig-authenticated HTTP request to identity's localhost
 * endpoints from inside the identity pod.
 *
 * `path` is the request-path against the identity service, e.g.
 * ``"/internal/users/invite"`` or ``"/config/public"``.
 *
 * Returns the structured `{ status, body }` envelope, mapping identity's HTTP
 * response status into the same shape that earlier proxy-based callers
 * expect. Network/transport failures throw; HTTP errors (any non-2xx) are
 * returned as a normal envelope so callers can branch on status.
 */
export interface KubectlRawOptions {
  /** Target deployment in the namespace; defaults to "identity". */
  deployment?: string;
  /** Localhost port the in-pod service listens on; defaults to 8000. */
  port?: number;
  /** Additional HTTP headers to send (e.g. Authorization). */
  headers?: Record<string, string>;
  /**
   * Form-encoded body. Mutually exclusive with the JSON body parameter; when
   * set, the in-pod shim sends Content-Type: application/x-www-form-urlencoded.
   */
  form?: Record<string, string>;
}

export async function kubectlRaw<T>(
  namespace: string,
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  opts: KubectlRawOptions = {},
): Promise<KubectlRawResponse<T>> {
  const deployment = opts.deployment ?? "identity";
  const port = opts.port ?? 8000;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };
  let input: string;
  if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    input = new URLSearchParams(opts.form).toString();
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    input = JSON.stringify(body);
  } else {
    input = "";
  }
  // Build a parameterised proxy script that accepts headers + port via JSON
  // stdin prelude. We keep the original script untouched for backward compat;
  // the generalised script is used when extra options are set.
  const generalised = !!opts.headers || !!opts.form || port !== 8000;
  const script = generalised ? PROXY_SCRIPT_V2 : PROXY_SCRIPT;
  const args = [
    "exec",
    "-i",
    "-n",
    namespace,
    `deployment/${deployment}`,
    "--",
    "python",
    "-c",
    script,
    method,
    path,
  ];
  if (generalised) {
    args.push(String(port), JSON.stringify(headers));
  }
  let result;
  try {
    result = await execa("kubectl", args, { input, all: false });
  } catch (err) {
    const e = err as ExecaError;
    throw new Error(
      `kubectl exec → identity HTTP failed: ${asString(e.stderr).trim() || e.shortMessage || e.message}`,
    );
  }
  const stdout = asString(result.stdout).trim();
  if (stdout === "") {
    throw new Error("kubectl exec → identity HTTP returned empty stdout");
  }
  let parsed: ProxyEnvelope<T>;
  try {
    parsed = JSON.parse(stdout) as ProxyEnvelope<T>;
  } catch (parseErr) {
    throw new Error(
      `kubectl exec → identity HTTP response was not valid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
    );
  }
  return { status: parsed.status, body: parsed.body };
}

/**
 * Convenience wrapper kept for backward compatibility with callers that built
 * an `http:identity:80/proxy/...` style path. The new `kubectlRaw` takes a
 * plain HTTP path (e.g. `/internal/users/invite`); `identityServicePath`
 * therefore now strips the proxy prefix if present.
 */
export function identityServicePath(endpointPath: string): string {
  const trimmed = endpointPath.startsWith("/")
    ? endpointPath
    : `/${endpointPath}`;
  return trimmed;
}
