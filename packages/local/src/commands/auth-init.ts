/**
 * FR-015 — `ix local init`: Admin Bootstrap
 *
 * Bootstraps the initial admin account by invoking identity's in-pod CLI via
 * `kubectl exec`, then writes the captured credential to the
 * `system/admin-bootstrap` Secret (FR-019).
 *
 * Per auth/ADR-004 + auth/FR-008-CON-1, this command SHALL NOT reach identity
 * via any HTTP / HTTPS / API server proxy / port / network endpoint. The only
 * acceptable mechanism is `kubectl exec` against the identity pod (identity
 * FR-029, FR-017). Verified by static analysis (TC-080, TC-086).
 *
 * NFR-004 (auth): the temp password is printed to stdout once and stored only
 * in the K8s Secret — never in files, env vars, or logs.
 */

import { execa } from "execa";
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

interface SeedResponse {
  user_id: string;
  password: string;
  expires_at: string;
  login_url: string;
}

interface SecretData {
  data?: {
    expires_at?: string;
    login_url?: string;
  };
}

const IDENTITY_DEPLOYMENT = "identity";
const IDENTITY_CLI_INIT = [
  "python",
  "-m",
  "identity.cli",
  "init-admin",
  "--output",
  "json",
];

/**
 * Check whether the admin-bootstrap Secret already exists in `system`.
 * Returns the decoded data if found, or null if absent.
 */
async function getExistingBootstrapSecret(): Promise<{
  expiresAt: string;
  loginUrl: string;
} | null> {
  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "secret/admin-bootstrap",
      "-n",
      IX_SYSTEM_NAMESPACE,
      "-o",
      "json",
      "--ignore-not-found",
    ]);
    if (!stdout.trim()) return null;
    const obj = JSON.parse(stdout) as SecretData;
    const data = obj.data ?? {};
    const expiresAt = data.expires_at
      ? Buffer.from(data.expires_at, "base64").toString("utf-8")
      : "";
    const loginUrl = data.login_url
      ? Buffer.from(data.login_url, "base64").toString("utf-8")
      : "";
    return { expiresAt, loginUrl };
  } catch {
    return null;
  }
}

function diagnoseExecError(err: KubectlExecError): string {
  // identity FR-029 §5: stable exit code contract.
  if (err.exitCode === 2) {
    // admin_exists
    return "An admin already exists. To recover a lost password use: ix local auth reset-admin";
  }
  if (err.exitCode === 3) {
    return `identity database unreachable: ${err.stderr.trim() || err.message}`;
  }
  // Generic surface — bubble up the in-pod CLI's error envelope verbatim so the
  // operator can see what happened.
  const detail = err.stderr.trim() || err.message;
  return `identity init-admin failed (exit ${err.exitCode}): ${detail}`;
}

export async function runAuthInit(
  _config: IxConfig,
  deps?: IdentityDeps,
): Promise<void> {
  const _exec = deps?.kubectlExecJson ?? kubectlExecJson;

  const list = startListing("ix local auth init");
  list.commit();

  let seedResp: SeedResponse | null = null;
  let alreadyBootstrapped: { expiresAt: string; loginUrl: string } | null =
    null;

  const tasks = makeListr(
    [
      {
        title: "Checking for existing admin bootstrap Secret",
        task: async (_ctx, task) => {
          const existing = await getExistingBootstrapSecret();
          if (existing) {
            // FR-015-AC-2: idempotent re-run before first rotation — record and skip remainder
            task.output = `Admin bootstrap Secret already exists (expires ${existing.expiresAt})`;
            alreadyBootstrapped = existing;
            return;
          }
          task.output = "No existing bootstrap Secret found";
        },
      },

      {
        title: "Seeding admin account (kubectl exec → identity.cli init-admin)",
        skip: () => alreadyBootstrapped !== null,
        task: async (_ctx, task) => {
          task.output = `kubectl exec -n ${IX_AUTH_NAMESPACE} deployment/${IDENTITY_DEPLOYMENT} -- ${IDENTITY_CLI_INIT.join(" ")}`;
          try {
            seedResp = await _exec<SeedResponse>(
              IX_AUTH_NAMESPACE,
              IDENTITY_DEPLOYMENT,
              IDENTITY_CLI_INIT,
            );
          } catch (err) {
            if (err instanceof KubectlExecError) {
              throw new Error(diagnoseExecError(err));
            }
            throw err;
          }
          task.output = "Admin account created";
        },
      },

      {
        title: `Writing admin-bootstrap Secret to ${IX_SYSTEM_NAMESPACE}`,
        skip: () => alreadyBootstrapped !== null,
        task: async (_ctx, task) => {
          if (!seedResp) throw new Error("No seed response available");
          await writeAdminBootstrapSecret({
            password: seedResp.password,
            expiresAt: seedResp.expires_at,
            userId: seedResp.user_id,
            loginUrl: seedResp.login_url,
          });
          task.output = `Secret ${IX_SYSTEM_NAMESPACE}/admin-bootstrap written`;
        },
      },
    ],
    { concurrent: false },
  );

  try {
    await tasks.run();

    // FR-015-AC-2: idempotent re-run — secret already exists
    if (alreadyBootstrapped) {
      const bootstrapped = alreadyBootstrapped as {
        expiresAt: string;
        loginUrl: string;
      };
      list.note(`Expires at: ${bootstrapped.expiresAt}`);
      list.note(`Log in at:  ${bootstrapped.loginUrl}`);
      list.note(
        `Retrievable via: kubectl -n ${IX_SYSTEM_NAMESPACE} get secret admin-bootstrap -o jsonpath='{.data.password}' | base64 -d`,
      );
      list.success("Admin account already bootstrapped.");
      process.exit(0);
      return;
    }

    if (!seedResp) throw new Error("No seed response");
    const resp = seedResp as SeedResponse;

    // FR-015-B6: print to stdout once — never to a log (NFR-004-AC-2)
    list.note("Username:      admin");
    list.note(
      `Temp password: ${resp.password}     (expires ${resp.expires_at})`,
    );
    list.note(`Log in at:     ${resp.login_url}`);
    list.note(
      `Retrievable via: kubectl -n ${IX_SYSTEM_NAMESPACE} get secret admin-bootstrap -o jsonpath='{.data.password}' | base64 -d`,
    );
    list.success("Admin account created.");
  } catch (err) {
    list.error(
      `init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
