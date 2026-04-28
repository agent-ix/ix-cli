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

type ExecFn = typeof kubectlExecJson;
export interface IdentityDeps {
  kubectlExecJson?: ExecFn;
}

interface ResetResponse {
  user_id: string;
  password: string;
  expires_at: string;
  login_url: string;
}

const IDENTITY_DEPLOYMENT = "identity";

function buildResetArgv(opts: { user?: string }): string[] {
  const argv = [
    "python",
    "-m",
    "identity.cli",
    "reset-admin",
    "--output",
    "json",
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
  if (err.exitCode === 4) {
    return "No admin user exists. Run `ix local init` to bootstrap one.";
  }
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
  _config: IxConfig,
  opts: { user?: string },
  deps?: IdentityDeps,
): Promise<void> {
  const _exec = deps?.kubectlExecJson ?? kubectlExecJson;
  const argv = buildResetArgv(opts);

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
            loginUrl: resetResp.login_url,
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

    // FR-016-B5: print to stdout once — never to a log.
    list.note(`User id:       ${resp.user_id}`);
    list.note(`Temp password: ${resp.password}   (expires ${resp.expires_at})`);
    list.note(`Log in at:     ${resp.login_url}`);
    list.note(
      `Retrievable via: kubectl -n ${IX_SYSTEM_NAMESPACE} get secret admin-bootstrap -o jsonpath='{.data.password}' | base64 -d`,
    );
    list.success("Admin password reset.");
  } catch (err) {
    list.error(
      `auth reset-admin failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
