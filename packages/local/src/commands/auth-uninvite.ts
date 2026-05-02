/**
 * FR-018 — `ix local auth uninvite <email>`
 *
 * Revokes any outstanding invite tokens for an unclaimed user via identity's
 * `POST /internal/users/uninvite` endpoint. Identity supersedes pending invite
 * tokens and clears the user's temp_credential_* fields. The user row itself
 * remains; if the account has been claimed (password set), identity returns
 * 409 and the operator should use the password-reset flow instead.
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

interface UninviteResponse {
  user_id: string;
  email: string;
  revoked: number;
}

interface ErrorResponse {
  error?: string;
  hint?: string;
  detail?: string | { error?: string; hint?: string };
}

export async function runAuthUninvite(
  _config: IxConfig,
  email: string,
  deps?: IdentityDeps,
): Promise<void> {
  const _raw = deps?.kubectlRaw ?? kubectlRaw;

  const list = startListing("ix local auth uninvite");
  list.commit();

  let resp: UninviteResponse | null = null;

  const tasks = makeListr(
    [
      {
        title: `Revoking invites for ${email}`,
        task: async (_ctx, task) => {
          const { status, body } = await _raw<UninviteResponse | ErrorResponse>(
            IX_AUTH_NAMESPACE,
            identityServicePath("/internal/users/uninvite"),
            "POST",
            { email },
          );

          if (status === 200) {
            resp = body as UninviteResponse;
            task.output = `Revoked ${resp.revoked} token(s)`;
            return;
          }

          // FastAPI wraps HTTPException payloads under `detail`.
          const errBody = body as ErrorResponse;
          const inner =
            typeof errBody.detail === "object" ? errBody.detail : errBody;
          const code = inner?.error;

          if (status === 404) {
            throw new Error(`user not found: ${email}`);
          }
          if (status === 409 && code === "account_claimed") {
            throw new Error(
              "Account already claimed — uninvite only revokes pending invites. " +
                "Use `ix local auth reset-user` to disable a claimed account's credentials.",
            );
          }
          throw new Error(
            `Uninvite failed (HTTP ${status}): ${JSON.stringify(body)}`,
          );
        },
      },
    ],
    { concurrent: false },
  );

  try {
    await tasks.run();
    if (!resp) throw new Error("No uninvite response");
    const r = resp as UninviteResponse;
    list.note(`User:    ${r.email}`);
    list.note(`Revoked: ${r.revoked} token(s)`);
    list.success(
      r.revoked > 0
        ? "Outstanding invites revoked."
        : "No outstanding invites; nothing to revoke.",
    );
  } catch (err) {
    list.error(
      `auth uninvite failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
