/**
 * FR-017 — `ix local auth invite <email>`
 *
 * Creates a pending user via identity's `POST /internal/users/invite` endpoint
 * and surfaces the invite URL to the operator.
 *
 * Per ix-cli/spec/functional/local/auth.md, identity is reached through the
 * Kubernetes API server's authenticated service proxy (kubeconfig-gated),
 * never via the public ingress. NetworkPolicy on the `auth` namespace SHALL
 * additionally restrict `/internal/*` to in-cluster callers (the API server
 * proxy counts as in-cluster).
 *
 * Email delivery is handled entirely by identity (auth/FR-027).
 */

import type { IxConfig } from "../config.js";
import {
  kubectlRaw,
  identityServicePath,
  IX_AUTH_NAMESPACE,
} from "./auth-identity.js";
import { Listing, Note, renderStatic } from "@agent-ix/ix-ui-cli";

type RawFn = typeof kubectlRaw;
export interface IdentityDeps {
  kubectlRaw?: RawFn;
}

interface PublicConfig {
  registration?: {
    mode?: string;
  };
}

interface InviteResponse {
  user_id: string;
  email: string;
  invite_url: string;
  expires_at: string;
  email_sent: boolean;
  email_send_reason?: string | null;
}

interface ErrorResponse {
  detail?: string;
  code?: string;
  unknown_groups?: string[];
}

const HEADER = "ix local auth invite";

async function renderFailure(msg: string): Promise<void> {
  await renderStatic(
    <Listing
      header={HEADER}
      status="failed"
      tail={`auth invite failed: ${msg}`}
      tailVariant="error"
    />,
  );
}

export async function runAuthInvite(
  _config: IxConfig,
  email: string,
  opts: {
    username?: string;
    displayName?: string;
    groups?: string;
    ttl?: number;
  },
  deps?: IdentityDeps,
): Promise<void> {
  const _raw = deps?.kubectlRaw ?? kubectlRaw;

  const ttlHours = opts.ttl ?? 72;
  if (ttlHours < 1 || ttlHours > 168) {
    await renderFailure("--ttl must be between 1 and 168 hours");
    throw new Error("--ttl must be between 1 and 168 hours");
  }

  // Pre-flight: registration mode
  try {
    const { status, body } = await _raw<PublicConfig>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/config/public"),
      "GET",
    );
    if (status !== 200) {
      throw new Error(`Failed to read identity config (HTTP ${status})`);
    }
    const mode = body.registration?.mode;
    if (mode === "closed") {
      throw new Error(
        "Registration is closed. Enable invites with: ix local auth config registration set invite_only",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(msg);
    throw err;
  }

  // Invite
  let inviteResp: InviteResponse;
  try {
    const payload: Record<string, unknown> = {
      email,
      ttl_hours: ttlHours,
    };
    if (opts.username) payload.username = opts.username;
    if (opts.displayName) payload.display_name = opts.displayName;
    if (opts.groups)
      payload.groups = opts.groups.split(",").map((g) => g.trim());

    const { status, body } = await _raw<InviteResponse | ErrorResponse>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/internal/users/invite"),
      "POST",
      payload,
    );

    if (status === 201 || status === 200) {
      inviteResp = body as InviteResponse;
    } else {
      const errBody = body as ErrorResponse;
      if (status === 409) {
        throw new Error("A user with this email already exists.");
      }
      if (status === 403) {
        throw new Error(
          "Registration is closed. Enable invites with: ix local auth config registration set invite_only",
        );
      }
      if (status === 400 && errBody.code === "invalid_groups") {
        const unknown = errBody.unknown_groups?.join(", ") ?? "unknown";
        throw new Error(`Invalid groups: ${unknown}`);
      }
      throw new Error(
        `Invite failed (HTTP ${status}): ${JSON.stringify(body)}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(msg);
    throw err;
  }

  const emailLine = inviteResp.email_sent
    ? "yes"
    : inviteResp.email_send_reason
      ? `no (reason: ${inviteResp.email_send_reason})`
      : "no";

  await renderStatic(
    <Listing header={HEADER} status="passed" tail="Invite created.">
      <Note>{`User:        ${inviteResp.email}`}</Note>
      <Note>{`Expires:     ${inviteResp.expires_at}`}</Note>
      <Note>{`Invite URL:  ${inviteResp.invite_url}`}</Note>
      <Note>{`Email sent:  ${emailLine}`}</Note>
      {!inviteResp.email_sent && (
        <Note>Share the URL above with the user; it is single-use.</Note>
      )}
    </Listing>,
  );
}
