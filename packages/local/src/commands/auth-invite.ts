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
import { startListing, makeListr } from "@agent-ix/ix-ui-cli";

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

  const list = startListing("ix local auth invite");

  let inviteResp: InviteResponse | null = null;

  const ttlHours = opts.ttl ?? 72;
  if (ttlHours < 1 || ttlHours > 168) {
    list.error("--ttl must be between 1 and 168 hours");
    throw new Error("--ttl must be between 1 and 168 hours");
  }
  list.commit();

  const tasks = makeListr(
    [
      {
        title: "Pre-flight: checking registration mode",
        task: async (_ctx, task) => {
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
          task.output = `Registration mode: ${mode ?? "unknown"}`;
        },
      },

      {
        title: `Inviting ${email}`,
        task: async (_ctx, task) => {
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
            task.output = "Invite created";
            return;
          }

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
        },
      },
    ],
    { concurrent: false },
  );

  try {
    await tasks.run();

    if (!inviteResp) throw new Error("No invite response");
    const resp = inviteResp as InviteResponse;

    const emailLine = resp.email_sent
      ? "yes"
      : resp.email_send_reason
        ? `no (reason: ${resp.email_send_reason})`
        : "no";

    list.note(`User:        ${resp.email}`);
    list.note(`Expires:     ${resp.expires_at}`);
    list.note(`Invite URL:  ${resp.invite_url}`);
    list.note(`Email sent:  ${emailLine}`);
    if (!resp.email_sent) {
      list.note("Share the URL above with the user; it is single-use.");
    }
    list.success("Invite created.");
  } catch (err) {
    list.error(
      `auth invite failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
