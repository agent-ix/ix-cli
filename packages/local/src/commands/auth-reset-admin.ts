/**
 * FR-016 — auth reset-admin Command
 * Re-seeds a one-time temporary credential for the existing admin user.
 * Calls identity POST /internal/users/reset and writes the admin-bootstrap
 * Secret via the shared write path (FR-019, FR-016-CON-1).
 */

import { Listr } from "listr2";
import type { IxConfig } from "../config.js";
import { writeAdminBootstrapSecret } from "./auth-secret.js";
import { resolveIdentityUrl, fetchJson } from "./auth-identity.js";
import { startListing } from "@agent-ix/ix-ui-cli";

type ResolveFn = typeof resolveIdentityUrl;
type FetchFn = typeof fetchJson;
export interface IdentityDeps {
  resolveIdentityUrl?: ResolveFn;
  fetchJson?: FetchFn;
}

interface IdentityUser {
  id: string;
  email: string;
  role: string;
  status: string;
}

interface ResetResponse {
  user_id: string;
  email: string;
  reset_url: string;
  expires_at: string;
  // The reset URL embeds the token; we extract it as the "password" field.
  password?: string;
}

async function listAdminUsers(
  baseUrl: string,
  _fetch: FetchFn,
): Promise<IdentityUser[]> {
  const { status, body } = await _fetch<IdentityUser[] | { detail: string }>(
    `${baseUrl}/internal/users?role=admin&status=active`,
  );
  if (status !== 200) {
    throw new Error(
      `Failed to list admin users (HTTP ${status}): ${JSON.stringify(body)}`,
    );
  }
  return body as IdentityUser[];
}

async function resetUser(
  baseUrl: string,
  email: string,
  ttlHours: number,
  _fetch: FetchFn,
): Promise<ResetResponse> {
  const { status, body } = await _fetch<ResetResponse | { detail: string }>(
    `${baseUrl}/internal/users/reset`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_or_username: email, ttl_hours: ttlHours }),
    },
  );

  if (status === 404) {
    throw new Error(`user not found: ${email}`);
  }
  if (status === 503) {
    throw new Error("identity service unavailable (503)");
  }
  if (status !== 201 && status !== 200) {
    throw new Error(`Reset failed (HTTP ${status}): ${JSON.stringify(body)}`);
  }
  return body as ResetResponse;
}

export async function runAuthResetAdmin(
  config: IxConfig,
  opts: { user?: string; ttl?: number },
  deps?: IdentityDeps,
): Promise<void> {
  const _resolve = deps?.resolveIdentityUrl ?? resolveIdentityUrl;
  const _fetch = deps?.fetchJson ?? fetchJson;

  const list = startListing("ix local auth reset-admin");
  list.commit();

  let adminEmail = opts.user;
  let resetResp: ResetResponse | null = null;
  let identityBaseUrl = "";
  let cleanup: () => void = () => {};

  const tasks = new Listr(
    [
      {
        title: "Connecting to identity service",
        task: async (ctx, task) => {
          try {
            const resolved = await _resolve(18920);
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
        title: "Discovering admin user",
        task: async (ctx, task) => {
          let admins: IdentityUser[];
          try {
            admins = await listAdminUsers(identityBaseUrl, _fetch);
          } catch (err) {
            throw new Error(
              `identity service not found in namespace ix-system: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          if (admins.length === 0) {
            throw new Error("no admin to reset; run `ix local init`");
          }

          if (adminEmail) {
            const match = admins.find((u) => u.email === adminEmail);
            if (!match) {
              throw new Error(
                `No active admin user with email '${adminEmail}'. Active admins: ${admins.map((u) => u.email).join(", ")}`,
              );
            }
            task.output = `Using admin: ${adminEmail}`;
          } else if (admins.length === 1) {
            adminEmail = admins[0].email;
            task.output = `Found admin: ${adminEmail}`;
          } else {
            // FR-016-AC-5: multiple admins, no --user flag
            const adminList = admins.map((u) => `  • ${u.email}`).join("\n");
            throw new Error(
              `Multiple active admins found. Use --user <email> to select one:\n${adminList}`,
            );
          }
        },
      },

      {
        title: "Resetting admin password",
        task: async (ctx, task) => {
          const ttlHours = opts.ttl ?? 1;
          task.output = `Calling identity reset for ${adminEmail}...`;
          resetResp = await resetUser(
            identityBaseUrl,
            adminEmail!,
            ttlHours,
            _fetch,
          );
          task.output = "Reset token obtained";
        },
      },

      {
        title: "Writing admin-bootstrap Secret",
        task: async (ctx, task) => {
          if (!resetResp) throw new Error("No reset response available");
          // The reset URL contains the token; treat it as both token and URL.
          // If identity returns a separate password field, prefer that.
          const password = resetResp.password ?? resetResp.reset_url;
          await writeAdminBootstrapSecret({
            password,
            expiresAt: resetResp.expires_at,
            userId: resetResp.user_id,
            loginUrl: resetResp.reset_url,
          });
          task.output = "Secret ix-system/admin-bootstrap written";
        },
      },
    ],
    {
      concurrent: false,
      rendererOptions: { collapseSubtasks: false },
    },
  );

  try {
    await tasks.run();
    cleanup();

    if (!resetResp) throw new Error("No reset response");
    const password =
      (resetResp as ResetResponse).password ??
      (resetResp as ResetResponse).reset_url;

    // FR-016-B5: print to stdout (never to a log)
    list.note(`User:          ${adminEmail}`);
    list.note(
      `Temp password: ${password}   (expires ${(resetResp as ResetResponse).expires_at})`,
    );
    list.note(`Log in at:     ${(resetResp as ResetResponse).reset_url}`);
    list.success("Admin password reset.");
  } catch (err) {
    cleanup();
    list.error(
      `auth reset-admin failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
