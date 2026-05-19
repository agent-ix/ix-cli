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
import {
  FlowLine,
  Info,
  Listing,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";

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

const HEADER = "ix local auth reset-user";

async function renderFailure(msg: string): Promise<void> {
  await renderStatic(
    <Listing
      header={HEADER}
      status="failed"
      tail={`auth reset-user failed: ${msg}`}
      tailVariant="error"
    />,
  );
}

export async function runAuthResetUser(
  _config: IxConfig,
  email: string,
  opts: { ttl?: number },
  deps?: IdentityDeps,
): Promise<void> {
  const _raw = deps?.kubectlRaw ?? kubectlRaw;

  const ttlHours = opts.ttl ?? 1;
  if (ttlHours < 1 || ttlHours > 24) {
    await renderFailure("--ttl must be between 1 and 24 hours");
    throw new Error("--ttl must be between 1 and 24 hours");
  }

  let resetResp: ResetResponse;
  try {
    const { status, body } = await _raw<ResetResponse | ErrorResponse>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/internal/users/reset"),
      "POST",
      { email_or_username: email, ttl_hours: ttlHours },
    );

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
      throw new Error(`Reset forbidden (HTTP 403): ${JSON.stringify(body)}`);
    }
    if (status === 404) {
      throw new Error(`user not found: ${email}`);
    }
    if (status === 503) {
      throw new Error("identity service unavailable (503)");
    }
    if (status !== 201 && status !== 200) {
      throw new Error(`Reset failed (HTTP ${status}): ${JSON.stringify(body)}`);
    }

    resetResp = body as ResetResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(msg);
    throw err;
  }

  await renderStatic(
    <Listing
      header={HEADER}
      status="passed"
      variant="flow"
      pre={
        <FlowLine>{`Resetting password for ${blue(resetResp.email)}`}</FlowLine>
      }
      tail="Password reset."
    >
      <Info name="User" description={blue(resetResp.email)} />
      <Info name="Expires" description={resetResp.expires_at} />
      <Info name="Reset URL" description={blue(resetResp.reset_url)} />
      <Info name="Email sent" description={String(resetResp.email_sent)} />
    </Listing>,
  );
}
