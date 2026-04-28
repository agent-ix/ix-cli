/**
 * FR-015 — ix-local init: Admin Bootstrap
 * Seeds the initial admin account by calling identity POST /internal/admin/seed
 * and persists the returned temp credential in the ix-system/admin-bootstrap
 * Secret (FR-019).
 *
 * NFR-005: calls identity via port-forward (mode 2) or in-cluster DNS (mode 1),
 * never via public Ingress.
 * NFR-004: temp password is written to stdout once and stored only in the K8s
 * Secret — never in files, env vars, or logs.
 */

import { execa } from "execa";
import type { IxConfig } from "../config.js";
import { writeAdminBootstrapSecret } from "./auth-secret.js";
import { resolveIdentityUrl, fetchJson } from "./auth-identity.js";
import { startListing, makeListr } from "@agent-ix/ix-ui-cli";

type ResolveFn = typeof resolveIdentityUrl;
type FetchFn = typeof fetchJson;
export interface IdentityDeps {
  resolveIdentityUrl?: ResolveFn;
  fetchJson?: FetchFn;
}

interface SeedResponse {
  user_id: string;
  email: string;
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

/**
 * Check whether the admin-bootstrap Secret already exists.
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
      "ix-system",
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

export async function runAuthInit(
  _config: IxConfig,
  deps?: IdentityDeps,
): Promise<void> {
  const _resolve = deps?.resolveIdentityUrl ?? resolveIdentityUrl;
  const _fetch = deps?.fetchJson ?? fetchJson;

  const list = startListing("ix local auth init");
  list.commit();

  let identityBaseUrl = "";
  let cleanup: () => void = () => {};
  let seedResp: SeedResponse | null = null;
  let alreadyBootstrapped: { expiresAt: string; loginUrl: string } | null =
    null;

  const tasks = makeListr(
    [
      {
        title: "Connecting to identity service",
        task: async (ctx, task) => {
          try {
            const resolved = await _resolve(18923);
            identityBaseUrl = resolved.baseUrl;
            cleanup = resolved.cleanup;
            task.output = `Connected at ${identityBaseUrl}`;
          } catch (err) {
            throw new Error(
              `identity service not found in namespace ix-system: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      },

      {
        title: "Checking for existing admin bootstrap Secret",
        task: async (ctx, task) => {
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
        title: "Seeding admin account",
        skip: () => alreadyBootstrapped !== null,
        task: async (ctx, task) => {
          task.output = "Calling identity /internal/admin/seed...";

          const { status, body } = await _fetch<
            SeedResponse | { detail?: string; code?: string }
          >(`${identityBaseUrl}/internal/admin/seed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });

          if (status === 409) {
            const errBody = body as { code?: string };
            if (errBody.code === "admin_exists" || status === 409) {
              throw new Error(
                "An admin already exists. To recover a lost password use: ix local admin-reset",
              );
            }
          }

          if (status !== 201 && status !== 200) {
            throw new Error(
              `Admin seed failed (HTTP ${status}): ${JSON.stringify(body)}`,
            );
          }

          seedResp = body as SeedResponse;
          task.output = "Admin account created";
        },
      },

      {
        title: "Writing admin-bootstrap Secret",
        skip: () => alreadyBootstrapped !== null,
        task: async (ctx, task) => {
          if (!seedResp) throw new Error("No seed response available");
          await writeAdminBootstrapSecret({
            password: seedResp.password,
            expiresAt: seedResp.expires_at,
            userId: seedResp.user_id,
            loginUrl: seedResp.login_url,
          });
          task.output = "Secret ix-system/admin-bootstrap written";
        },
      },
    ],
    { concurrent: false },
  );

  try {
    await tasks.run();
    cleanup();

    // FR-015-AC-2: idempotent re-run — secret already exists
    if (alreadyBootstrapped) {
      // TS 5.4+ loses narrowing for let-vars mutated in async closures; cast is safe here
      const bootstrapped = alreadyBootstrapped as {
        expiresAt: string;
        loginUrl: string;
      };
      list.note(`Expires at: ${bootstrapped.expiresAt}`);
      list.note(`Log in at:  ${bootstrapped.loginUrl}`);
      list.note(
        `Retrievable via: kubectl -n ix-system get secret admin-bootstrap -o jsonpath='{.data.password}' | base64 -d`,
      );
      list.success("Admin account already bootstrapped.");
      process.exit(0);
      return;
    }

    if (!seedResp) throw new Error("No seed response");
    const resp = seedResp as SeedResponse;

    // FR-015-B6: print to stdout once — never to a log (NFR-004-AC-2)
    list.note(`Username:      admin`);
    list.note(
      `Temp password: ${resp.password}     (expires ${resp.expires_at})`,
    );
    list.note(`Log in at:     ${resp.login_url}`);
    list.note(
      `Retrievable via: kubectl -n ix-system get secret admin-bootstrap -o jsonpath='{.data.password}' | base64 -d`,
    );
    list.success("Admin account created.");
  } catch (err) {
    cleanup();
    list.error(
      `init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
