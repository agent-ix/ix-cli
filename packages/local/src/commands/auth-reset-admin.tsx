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
import {
  GLYPH_DIM_DOT,
  Listing,
  Note,
  Text,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";

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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

const IDENTITY_DEPLOYMENT = "identity";
const HEADER = "ix local auth reset-admin";

function buildResetArgv(opts: { user?: string }, newEmail: string): string[] {
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
  const stderr = err.stderr.trim();
  if (err.exitCode === 5) {
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

async function renderFailure(msg: string): Promise<void> {
  await renderStatic(
    <Listing
      header={HEADER}
      status="failed"
      tail={`auth reset-admin failed: ${msg}`}
      tailVariant="error"
    />,
  );
}

export async function runAuthResetAdmin(
  config: IxConfig,
  opts: { user?: string },
  deps?: IdentityDeps,
): Promise<void> {
  const _exec = deps?.kubectlExecJson ?? kubectlExecJson;
  const newEmail = `admin@${config.internalBaseDomain}`;
  const argv = buildResetArgv(opts, newEmail);

  let resetResp: ResetResponse;
  try {
    try {
      resetResp = await _exec<ResetResponse>(
        IX_AUTH_NAMESPACE,
        IDENTITY_DEPLOYMENT,
        argv,
      );
    } catch (err) {
      if (err instanceof KubectlExecError && err.exitCode === 4) {
        // No admin exists yet — create one via init-admin
        const initArgv = buildInitArgv(newEmail);
        resetResp = await _exec<ResetResponse>(
          IX_AUTH_NAMESPACE,
          IDENTITY_DEPLOYMENT,
          initArgv,
        );
      } else if (err instanceof KubectlExecError) {
        throw new Error(diagnoseExecError(err));
      } else {
        throw err;
      }
    }

    await writeAdminBootstrapSecret({
      password: resetResp.password,
      expiresAt: resetResp.expires_at,
      userId: resetResp.user_id,
      loginUrl: `https://identity.${config.internalBaseDomain}/login`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(msg);
    throw err;
  }

  // FR-016-B5: print to stdout once — never to a log.
  await renderStatic(
    <Listing
      header={HEADER}
      status="passed"
      variant="flow"
      pre={
        <Text>
          {` ${GLYPH_DIM_DOT} Resetting admin in ${blue(IX_SYSTEM_NAMESPACE)}`}
        </Text>
      }
      tail={`Secret ${blue(`${IX_SYSTEM_NAMESPACE}/admin-bootstrap`)} written.`}
    >
      <Note>{`User ID:       ${resetResp.user_id}`}</Note>
      <Note>{`Username:      ${resetResp.username ?? "admin"}`}</Note>
      <Note>{`Email:         ${blue(resetResp.email ?? resetResp.username ?? "admin")}`}</Note>
      <Note>{`Temp password: ${resetResp.password}`}</Note>
      <Note>{`Expires at:    ${formatExpiresAt(resetResp.expires_at)}`}</Note>
    </Listing>,
  );
}
