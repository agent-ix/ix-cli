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

import React from "react";
import type { IxConfig } from "../config.js";
import { execa, type ExecaError } from "execa";
import { writeAdminBootstrapSecret } from "./auth-secret.js";
import {
  kubectlExecJson,
  KubectlExecError,
  IX_SYSTEM_NAMESPACE,
  IX_AUTH_NAMESPACE,
} from "./auth-identity.js";
import { Listing, Note, renderStatic } from "@agent-ix/ix-ui-cli";

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

const HEADER = "ix local auth init";

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

async function renderFailure(msg: string): Promise<void> {
  await renderStatic(
    <Listing
      header={HEADER}
      status="failed"
      tail={`init failed: ${msg}`}
      tailVariant="error"
    />,
  );
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

  let seedResp: SeedResponse | null = null;
  let adminExists = false;

  try {
    seedResp = await _exec<SeedResponse>(
      IX_AUTH_NAMESPACE,
      IDENTITY_DEPLOYMENT,
      IDENTITY_CLI_INIT,
    );
  } catch (err) {
    if (err instanceof KubectlExecError) {
      if (err.exitCode === 2) {
        adminExists = true;
      } else if (err.exitCode === 3) {
        const msg = `identity database unreachable: ${err.stderr.trim() || err.message}`;
        await renderFailure(msg);
        throw new Error(msg);
      } else if (isIdentityDeploymentMissing(err)) {
        const msg = bootstrapIfMissing
          ? "identity deployment missing after auth bootstrap"
          : "identity deployment missing; run `ix local up auth` first";
        await renderFailure(msg);
        throw new Error(msg);
      } else {
        const msg = `identity init-admin failed (exit ${err.exitCode}): ${err.stderr.trim() || err.message}`;
        await renderFailure(msg);
        throw new Error(msg);
      }
    } else {
      await renderFailure(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  if (adminExists) {
    await renderStatic(
      <Listing
        header={HEADER}
        status="passed"
        tail="Admin already exists. Use `ix local auth reset-admin` to reset the password."
        tailVariant="warn"
      />,
    );
    return;
  }

  if (!seedResp) throw new Error("No seed response");
  const resp: SeedResponse = seedResp;

  try {
    await writeAdminBootstrapSecret({
      password: resp.password,
      expiresAt: resp.expires_at,
      userId: resp.user_id,
      loginUrl: resp.login_url,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(msg);
    throw err;
  }

  // FR-015-B6: print to stdout once — never to a log (NFR-004-AC-2)
  await renderStatic(
    <Listing header={HEADER} status="passed" tail="Admin account created.">
      <Note>{`Username:      admin`}</Note>
      <Note>{`Temp password: ${resp.password}     (expires ${formatExpiry(resp.expires_at)})`}</Note>
      <Note>{`Log in at:     ${resp.login_url}`}</Note>
      <Note>{`Secret:        ${IX_SYSTEM_NAMESPACE}/admin-bootstrap`}</Note>
    </Listing>,
  );
}
