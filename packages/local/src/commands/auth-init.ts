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

import type { IxConfig } from "../config.js";
import { execa, type ExecaError } from "execa";
import { writeAdminBootstrapSecret } from "./auth-secret.js";
import {
  kubectlExecJson,
  KubectlExecError,
  IX_SYSTEM_NAMESPACE,
  IX_AUTH_NAMESPACE,
} from "./auth-identity.js";
import { startListing, makeListr } from "@agent-ix/ix-ui-cli";

type ExecFn = typeof kubectlExecJson;
type EnsureIdentityFn = (config: IxConfig) => Promise<void>;
type HasIdentityDeploymentFn = () => Promise<boolean>;
export interface AuthInitOptions {
  bootstrapIfMissing?: boolean;
}
export interface IdentityDeps {
  kubectlExecJson?: ExecFn;
  ensureIdentityDeployment?: EnsureIdentityFn;
  hasIdentityDeployment?: HasIdentityDeploymentFn;
}

interface SeedResponse {
  user_id: string;
  password: string;
  expires_at: string;
  login_url: string;
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const IDENTITY_DEPLOYMENT = "identity";
const AUTH_DEPLOYABLE = IX_AUTH_NAMESPACE;
const IDENTITY_CLI_INIT = [
  "python",
  "-m",
  "identity.cli",
  "init-admin",
  "--output",
  "json",
];

function isIdentityDeploymentMissing(err: KubectlExecError): boolean {
  const stderr = err.stderr.trim();
  return /deployments\.apps "identity" not found/i.test(stderr);
}

async function hasIdentityDeployment(): Promise<boolean> {
  try {
    await execa("kubectl", [
      "get",
      "deployment",
      IDENTITY_DEPLOYMENT,
      "-n",
      IX_AUTH_NAMESPACE,
      "-o",
      "name",
    ]);
    return true;
  } catch (err) {
    const e = err as ExecaError;
    const stderr = String(e.stderr ?? "").trim();
    if (/notfound/i.test(stderr)) return false;
    throw new Error(
      `failed to check identity deployment: ${stderr || e.shortMessage || e.message}`,
    );
  }
}

async function ensureIdentityDeployment(config: IxConfig): Promise<void> {
  void config;
  const { runUp } = await import("../index.js");
  await runUp([AUTH_DEPLOYABLE]);
}

export async function runAuthInit(
  config: IxConfig,
  deps?: IdentityDeps,
  opts: AuthInitOptions = {},
): Promise<void> {
  const _exec = deps?.kubectlExecJson ?? kubectlExecJson;
  const ensureIdentity =
    deps?.ensureIdentityDeployment ?? ensureIdentityDeployment;
  const hasIdentity = deps?.hasIdentityDeployment ?? hasIdentityDeployment;
  const bootstrapIfMissing = opts.bootstrapIfMissing ?? true;

  if (!(await hasIdentity()) && bootstrapIfMissing) {
    await ensureIdentity(config);
  }

  const list = startListing("ix local auth init");
  list.commit();

  let seedResp: SeedResponse | null = null;
  let adminExists = false;

  const seedTask = makeListr(
    [
      {
        title: "Seeding admin account (kubectl exec → identity.cli init-admin)",
        task: async (_ctx, task) => {
          const commandText = `kubectl exec -n ${IX_AUTH_NAMESPACE} deployment/${IDENTITY_DEPLOYMENT} -- ${IDENTITY_CLI_INIT.join(" ")}`;
          task.output = commandText;
          try {
            seedResp = await _exec<SeedResponse>(
              IX_AUTH_NAMESPACE,
              IDENTITY_DEPLOYMENT,
              IDENTITY_CLI_INIT,
            );
            task.output = "Admin account created";
            return;
          } catch (err) {
            if (err instanceof KubectlExecError) {
              if (err.exitCode === 2) {
                adminExists = true;
                task.output = "Admin user already exists";
                return;
              }
              if (err.exitCode === 3) {
                throw new Error(
                  `identity database unreachable: ${err.stderr.trim() || err.message}`,
                );
              }
              if (isIdentityDeploymentMissing(err)) {
                throw new Error(
                  bootstrapIfMissing
                    ? "identity deployment missing after auth bootstrap"
                    : "identity deployment missing; run `ix local up auth` first",
                );
              }
              throw new Error(
                `identity init-admin failed (exit ${err.exitCode}): ${err.stderr.trim() || err.message}`,
              );
            }
            throw err;
          }
        },
      },
    ],
    { concurrent: false },
  );

  try {
    await seedTask.run();
  } catch (err) {
    list.error(
      `init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }

  if (adminExists) {
    list.note(
      "Admin already exists. Use `ix local auth reset-admin` to reset the password.",
    );
    return;
  }

  const writeTask = makeListr(
    [
      {
        title: `Writing admin-bootstrap Secret to ${IX_SYSTEM_NAMESPACE}`,
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
    await writeTask.run();
  } catch (err) {
    list.error(
      `init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }

  if (!seedResp) throw new Error("No seed response");
  const resp = seedResp as SeedResponse;

  // FR-015-B6: print to stdout once — never to a log (NFR-004-AC-2)
  list.note("Username:      admin");
  list.note(
    `Temp password: ${resp.password}     (expires ${formatExpiry(resp.expires_at)})`,
  );
  list.note(`Log in at:     ${resp.login_url}`);
  list.success("Admin account created.");
}
