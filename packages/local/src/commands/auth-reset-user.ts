/**
 * FR-018 — auth reset-user Command
 * Triggers an admin-initiated password reset on any existing user.
 * Works regardless of identity.password_reset.mode (admin path is always available).
 */

import { Listr } from "listr2";
import type { IxConfig } from "../config.js";
import { resolveIdentityUrl, fetchJson } from "./auth-identity.js";
import { introCommand, outroSuccess, outroError } from "@agent-ix/ix-ui-cli";

type ResolveFn = typeof resolveIdentityUrl;
type FetchFn = typeof fetchJson;
export interface IdentityDeps {
  resolveIdentityUrl?: ResolveFn;
  fetchJson?: FetchFn;
}

interface ResetResponse {
  user_id: string;
  email: string;
  reset_url: string;
  expires_at: string;
  email_sent: boolean;
}

export async function runAuthResetUser(
  config: IxConfig,
  email: string,
  opts: { ttl?: number },
  deps?: IdentityDeps,
): Promise<void> {
  const _resolve = deps?.resolveIdentityUrl ?? resolveIdentityUrl;
  const _fetch = deps?.fetchJson ?? fetchJson;

  introCommand("ix-local auth reset-user");

  const ttlHours = opts.ttl ?? 1;
  if (ttlHours < 1 || ttlHours > 24) {
    outroError("--ttl must be between 1 and 24 hours");
    throw new Error("--ttl must be between 1 and 24 hours");
  }

  let identityBaseUrl = "";
  let cleanup: () => void = () => {};
  let resetResp: ResetResponse | null = null;

  const tasks = new Listr(
    [
      {
        title: "Connecting to identity service",
        task: async (ctx, task) => {
          try {
            const resolved = await _resolve(18922);
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
        title: `Resetting password for ${email}`,
        task: async (ctx, task) => {
          task.output = `Calling identity reset for ${email}...`;

          const { status, body } = await _fetch<
            ResetResponse | { detail?: string; code?: string }
          >(`${identityBaseUrl}/internal/users/reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email_or_username: email,
              ttl_hours: ttlHours,
            }),
          });

          if (status === 404) {
            throw new Error(`user not found: ${email}`);
          }
          if (status === 503) {
            throw new Error("identity service unavailable (503)");
          }
          if (status !== 201 && status !== 200) {
            throw new Error(
              `Reset failed (HTTP ${status}): ${JSON.stringify(body)}`,
            );
          }

          resetResp = body as ResetResponse;
          task.output = "Reset token obtained";
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
    const resp = resetResp as ResetResponse;

    outroSuccess(
      [
        "Password reset.",
        `  User:       ${resp.email}`,
        `  Expires:    ${resp.expires_at}`,
        `  Reset URL:  ${resp.reset_url}`,
        `  Email sent: ${resp.email_sent}`,
      ].join("\n"),
    );
  } catch (err) {
    cleanup();
    outroError(
      `auth reset-user failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
