/**
 * FR-017 — auth invite Command
 * Creates a pending user via identity's invite endpoint and surfaces the
 * invite URL. Email delivery is handled entirely by identity.
 */

import { Listr } from "listr2";
import pc from "picocolors";
import * as p from "@clack/prompts";
import type { IxConfig } from "../config.js";
import { resolveIdentityUrl, fetchJson } from "./auth-identity.js";

type ResolveFn = typeof resolveIdentityUrl;
type FetchFn = typeof fetchJson;
export interface IdentityDeps {
  resolveIdentityUrl?: ResolveFn;
  fetchJson?: FetchFn;
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
}

interface ErrorResponse {
  detail?: string;
  code?: string;
  unknown_groups?: string[];
}

export async function runAuthInvite(
  config: IxConfig,
  email: string,
  opts: {
    username?: string;
    displayName?: string;
    groups?: string;
    ttl?: number;
  },
  deps?: IdentityDeps,
): Promise<void> {
  const _resolve = deps?.resolveIdentityUrl ?? resolveIdentityUrl;
  const _fetch = deps?.fetchJson ?? fetchJson;

  p.intro(pc.bgCyan(pc.black(` ix-local auth invite `)));

  let identityBaseUrl = "";
  let cleanup: () => void = () => {};
  let inviteResp: InviteResponse | null = null;

  const ttlHours = opts.ttl ?? 72;
  if (ttlHours < 1 || ttlHours > 168) {
    p.outro(pc.red("--ttl must be between 1 and 168 hours"));
    throw new Error("--ttl must be between 1 and 168 hours");
  }

  const tasks = new Listr(
    [
      {
        title: "Connecting to identity service",
        task: async (ctx, task) => {
          try {
            const resolved = await _resolve(18921);
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
        title: "Pre-flight: checking registration mode",
        task: async (ctx, task) => {
          const { status, body } = await _fetch<PublicConfig>(
            `${identityBaseUrl}/config/public`,
          );
          if (status !== 200) {
            throw new Error(`Failed to read identity config (HTTP ${status})`);
          }
          const mode = body.registration?.mode;
          if (mode === "closed") {
            throw new Error(
              "Registration is closed. Enable invites with: ix-local auth config registration set invite_only",
            );
          }
          task.output = `Registration mode: ${mode ?? "unknown"}`;
        },
      },

      {
        title: `Inviting ${email}`,
        task: async (ctx, task) => {
          const payload: Record<string, unknown> = {
            email,
            ttl_hours: ttlHours,
          };
          if (opts.username) payload.username = opts.username;
          if (opts.displayName) payload.display_name = opts.displayName;
          if (opts.groups)
            payload.groups = opts.groups.split(",").map((g) => g.trim());

          const { status, body } = await _fetch<InviteResponse | ErrorResponse>(
            `${identityBaseUrl}/internal/users/invite`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
          );

          if (status === 201) {
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
              "Registration is closed. Enable invites with: ix-local auth config registration set invite_only",
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
    {
      concurrent: false,
      rendererOptions: { collapseSubtasks: false },
    },
  );

  try {
    await tasks.run();
    cleanup();

    if (!inviteResp) throw new Error("No invite response");
    const resp = inviteResp as InviteResponse;

    const lines = [
      "Invite created.",
      `  User:        ${resp.email}`,
      `  Expires:     ${resp.expires_at}`,
      `  Invite URL:  ${resp.invite_url}`,
      `  Email sent:  ${resp.email_sent}`,
    ];
    if (!resp.email_sent) {
      lines.push("Share the URL above with the user; it is single-use.");
    }

    p.outro(pc.green(lines.join("\n")));
  } catch (err) {
    cleanup();
    p.outro(
      pc.red(
        `auth invite failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    throw err;
  }
}
