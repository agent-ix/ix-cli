/**
 * FR-018 — `ix local auth uninvite <email>`
 *
 * Revokes any outstanding invite tokens for an unclaimed user via identity's
 * `POST /internal/users/uninvite` endpoint.
 */

import type { IxConfig } from "../config.js";
import {
  kubectlRaw,
  identityServicePath,
  IX_AUTH_NAMESPACE,
} from "./auth-identity.js";
import {
  GLYPH_DIM_DOT,
  Listing,
  Note,
  Text,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";

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

  let resp: UninviteResponse;
  try {
    const { status, body } = await _raw<UninviteResponse | ErrorResponse>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/internal/users/uninvite"),
      "POST",
      { email },
    );
    if (status === 200) {
      resp = body as UninviteResponse;
    } else {
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
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header="ix local auth uninvite"
        status="failed"
        tail={`auth uninvite failed: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  }

  await renderStatic(
    <Listing
      header="ix local auth uninvite"
      status="passed"
      variant="flow"
      pre={
        <Text>
          {` ${GLYPH_DIM_DOT} Revoking invites for ${blue(resp.email)}`}
        </Text>
      }
      tail={
        resp.revoked > 0
          ? `Revoked ${resp.revoked} invite(s) for ${blue(resp.email)}.`
          : `No outstanding invites for ${blue(resp.email)}.`
      }
    >
      <Note>{`User:    ${blue(resp.email)}`}</Note>
      <Note>{`Revoked: ${resp.revoked} token(s)`}</Note>
    </Listing>,
  );
}
