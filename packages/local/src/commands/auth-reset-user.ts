/**
 * FR-018 — `ix local auth reset-user <email>`
 *
 * Triggers an admin-initiated password reset on a non-admin user via identity's
 * `POST /internal/users/reset` endpoint.
 *
 * Per ix-cli/spec/functional/local/auth.md, identity is reached through the
 * Kubernetes API server's authenticated service proxy (kubeconfig-gated),
 * never via the public ingress.
 *
 * Identity SHALL refuse this endpoint when the target has the admin role
 * (returns 403 `cannot_reset_admin_via_api`); admin recovery uses
 * `ix local auth reset-admin` (kubectl exec → identity.cli reset-admin).
 */

import type { IxConfig } from "../config.js";
import {
  kubectlRaw,
  identityServicePath,
  IX_AUTH_NAMESPACE,
} from "./auth-identity.js";
import { startListing, makeListr } from "@agent-ix/ix-ui-cli";

type RawFn = typeof kubectlRaw;
export interface IdentityDeps {
  kubectlRaw?: RawFn;
}

interface ResetResponse {
  user_id: string;
  email: string;
  reset_url: string;
  expires_at: string;
  email_sent: boolean;
}

interface ErrorResponse {
  error?: string;
  detail?: string;
  code?: string;
}

export async function runAuthResetUser(
  _config: IxConfig,
  email: string,
  opts: { ttl?: number },
  deps?: IdentityDeps,
): Promise<void> {
  const _raw = deps?.kubectlRaw ?? kubectlRaw;

  const list = startListing("ix local auth reset-user");

  const ttlHours = opts.ttl ?? 1;
  if (ttlHours < 1 || ttlHours > 24) {
    list.error("--ttl must be between 1 and 24 hours");
    throw new Error("--ttl must be between 1 and 24 hours");
  }
  list.commit();

  let resetResp: ResetResponse | null = null;

  const tasks = makeListr(
    [
      {
        title: `Resetting password for ${email}`,
        task: async (_ctx, task) => {
          task.output = `kubectl --raw POST /internal/users/reset (${IX_AUTH_NAMESPACE}/identity)`;

          const { status, body } = await _raw<ResetResponse | ErrorResponse>(
            IX_AUTH_NAMESPACE,
            identityServicePath("/internal/users/reset"),
            "POST",
            { email_or_username: email, ttl_hours: ttlHours },
          );

          // identity FR-020-CON-5 / auth FR-008-CON-7: admin role refusal.
          // FastAPI wraps HTTPException payloads under `detail`, so check both
          // shapes to surface the structured `error` key.
          if (status === 403) {
            const errBody = body as ErrorResponse & { detail?: ErrorResponse };
            const inner = errBody.detail ?? errBody;
            const code = inner.error ?? inner.code;
            if (code === "cannot_reset_admin_via_api") {
              throw new Error(
                "Admin password reset is not exposed over any HTTP/API endpoint. " +
                  "Use `ix local auth reset-admin` (kubectl exec into identity pod).",
              );
            }
            throw new Error(
              `Reset forbidden (HTTP 403): ${JSON.stringify(body)}`,
            );
          }
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
    { concurrent: false },
  );

  try {
    await tasks.run();

    if (!resetResp) throw new Error("No reset response");
    const resp = resetResp as ResetResponse;

    list.note(`User:       ${resp.email}`);
    list.note(`Expires:    ${resp.expires_at}`);
    list.note(`Reset URL:  ${resp.reset_url}`);
    list.note(`Email sent: ${resp.email_sent}`);
    list.success("Password reset.");
  } catch (err) {
    list.error(
      `auth reset-user failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
