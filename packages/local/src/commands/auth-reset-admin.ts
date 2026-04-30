/**
 * FR-016 — `ix local auth reset-admin`
 *
 * Re-seeds a fresh single-use credential for the existing admin user by
 * invoking identity's in-pod CLI via `kubectl exec`. Result is written to the
 * `system/admin-bootstrap` Secret (FR-019).
 *
 * Per auth/ADR-004 + auth/FR-008-CON-1, this command SHALL NOT reach identity
 * via any HTTP / HTTPS / API server proxy / port / network endpoint. The only
 * acceptable mechanism is `kubectl exec` against the identity pod (identity
 * FR-029, FR-020 §2.3). Verified by static analysis (TC-080, TC-086).
 */

import type { IxConfig } from "../config.js";
import { writeAdminBootstrapSecret } from "./auth-secret.js";
import {
  kubectlExecJson,
  KubectlExecError,
  IX_SYSTEM_NAMESPACE,
  IX_AUTH_NAMESPACE,
} from "./auth-identity.js";
import { startListing, makeListr } from "@agent-ix/ix-ui-cli";

function buildInitArgv(email: string): string[] {
  return [
    "python",
    "-m",
    "identity.cli",
    "init-admin",
    "--email",
    email,
    "--output",
    "json",
  ];
}

type ExecFn = typeof kubectlExecJson;
export interface IdentityDeps {
  kubectlExecJson?: ExecFn;
}

interface ResetResponse {
  user_id: string;
  email?: string;
  username?: string;
  password: string;
  expires_at: string;
  login_url: string;
}

function formatExpiresAt(iso: string): string {
  // Drop fractional seconds and render as "YYYY-MM-DD HH:MM:SS UTC"
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

const IDENTITY_DEPLOYMENT = "identity";

function buildResetArgv(
  opts: { user?: string },
  newEmail: string,
): string[] {
  const argv = [
    "python",
    "-m",
    "identity.cli",
    "reset-admin",
    "--output",
    "json",
    "--new-email",
    newEmail,
  ];
  if (opts.user) {
    // identity FR-020 §2.3: --email / --username selector for ambiguous case.
    argv.push("--email", opts.user);
  }
  return argv;
}

interface AmbiguousAdminEnvelope {
  error: string;
  detail?: string;
  candidates?: string[];
}

function diagnoseExecError(err: KubectlExecError): string {
  // identity FR-029 §5: stable exit code contract.
  const stderr = err.stderr.trim();
  if (err.exitCode === 5) {
    // Try to surface the candidate list from the structured error envelope.
    try {
      const env = JSON.parse(stderr) as AmbiguousAdminEnvelope;
      const list = (env.candidates ?? []).map((c) => `  • ${c}`).join("\n");
      return `Multiple active admins. Use \`ix local auth reset-admin --user <email>\` to disambiguate:\n${list}`;
    } catch {
      return `Multiple active admins; pass --user <email>. Identity output: ${stderr}`;
    }
  }
  if (err.exitCode === 3) {
    return `identity database unreachable: ${stderr || err.message}`;
  }
  return `identity reset-admin failed (exit ${err.exitCode}): ${stderr || err.message}`;
}

export async function runAuthResetAdmin(
  config: IxConfig,
  opts: { user?: string },
  deps?: IdentityDeps,
): Promise<void> {
  const _exec = deps?.kubectlExecJson ?? kubectlExecJson;
  const newEmail = `admin@${config.internalBaseDomain}`;
  const argv = buildResetArgv(opts, newEmail);

  const list = startListing("ix local auth reset-admin");
  list.commit();

  let resetResp: ResetResponse | null = null;

  const tasks = makeListr(
    [
      {
        title:
          "Resetting admin password (kubectl exec → identity.cli reset-admin)",
        task: async (_ctx, task) => {
          task.output = `kubectl exec -n ${IX_AUTH_NAMESPACE} deployment/${IDENTITY_DEPLOYMENT} -- ${argv.join(" ")}`;
          try {
            resetResp = await _exec<ResetResponse>(
              IX_AUTH_NAMESPACE,
              IDENTITY_DEPLOYMENT,
              argv,
            );
          } catch (err) {
            if (err instanceof KubectlExecError) {
              if (err.exitCode === 4) {
                // No admin exists yet — create one via init-admin
                const initArgv = buildInitArgv(newEmail);
                task.output = `kubectl exec -n ${IX_AUTH_NAMESPACE} deployment/${IDENTITY_DEPLOYMENT} -- ${initArgv.join(" ")}`;
                resetResp = await _exec<ResetResponse>(
                  IX_AUTH_NAMESPACE,
                  IDENTITY_DEPLOYMENT,
                  initArgv,
                );
                task.output = "Admin account created";
                return;
              }
              throw new Error(diagnoseExecError(err));
            }
            throw err;
          }
          task.output = "Reset credential obtained";
        },
      },

      {
        title: `Writing admin-bootstrap Secret to ${IX_SYSTEM_NAMESPACE}`,
        task: async (_ctx, task) => {
          if (!resetResp) throw new Error("No reset response available");
          await writeAdminBootstrapSecret({
            password: resetResp.password,
            expiresAt: resetResp.expires_at,
            userId: resetResp.user_id,
            loginUrl: `https://identity.${config.internalBaseDomain}/login`,
          });
          task.output = `Secret ${IX_SYSTEM_NAMESPACE}/admin-bootstrap written`;
        },
      },
    ],
    { concurrent: false },
  );

  try {
    await tasks.run();
    if (!resetResp) throw new Error("No reset response");
    const resp = resetResp as ResetResponse;

    // The login_url returned by identity is built from its public_base_url
    // (defaults to localhost:8000); override with the cluster ingress host
    // derived from the configured internal base domain.
    const loginUrl = `https://identity.${config.internalBaseDomain}/login`;

    // FR-016-B5: print to stdout once — never to a log.
    list.note(`User ID:       ${resp.user_id}`);
    list.note(`Username:      ${resp.username ?? "admin"}`);
    list.note(`Email:         ${resp.email ?? resp.username ?? "admin"}`);
    list.note(`Temp password: ${resp.password}`);
    list.note(`Expires at:    ${formatExpiresAt(resp.expires_at)}`);
    list.note(`Log in at:     ${loginUrl}`);
  } catch (err) {
    list.error(
      `auth reset-admin failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
