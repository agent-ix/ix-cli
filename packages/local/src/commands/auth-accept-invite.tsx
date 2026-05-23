/**
 * FR-040 — `ix local auth accept-invite <token>`
 *
 * Headless consumption of an invite token via identity FR-032
 * (`POST /internal/users/accept-invite`). The decoded password SHALL NOT
 * appear in argv, stdout, stderr, log files, or any audit/telemetry surface
 * — auth/FR-008-CON-11 strengthened wording.
 */

import { randomBytes } from "node:crypto";
import {
  FlowLine,
  Info,
  Listing,
  Note,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";
import {
  IX_AUTH_NAMESPACE,
  identityServicePath,
  kubectlRaw,
} from "./auth-identity.js";

const HEADER = "ix local auth accept-invite";

type RawFn = typeof kubectlRaw;

export interface AcceptInviteDeps {
  kubectlRaw?: RawFn;
  /** Read full stdin contents (utf-8). Tests inject a string-producing stub. */
  readStdin?: () => Promise<string>;
  /** Generate a strong password. Tests inject a deterministic stub. */
  generatePassword?: () => string;
  /** Sink for the generated-password disclosure (stderr by default). */
  writeStderr?: (s: string) => void;
}

export interface AcceptInviteOptions {
  passwordStdin: boolean;
  generate: boolean;
  showGenerated: boolean;
}

interface AcceptInviteResponse {
  user_id: string;
  tenant_id: string;
  must_rotate?: boolean;
  hint?: string | null;
  // access_token / refresh_token deliberately omitted from the printed surface.
}

interface ErrorBody {
  error?: string;
  detail?: string | { error?: string; detail?: string };
}

async function renderFailure(msg: string): Promise<void> {
  await renderStatic(
    <Listing
      header={HEADER}
      status="failed"
      tail={`auth accept-invite failed: ${msg}`}
      tailVariant="error"
    />,
  );
}

function defaultGeneratePassword(): string {
  // 32 chars from a URL-safe alphabet. crypto.randomBytes -> base64url slice.
  return randomBytes(32).toString("base64").replace(/[+/=]/g, "").slice(0, 32);
}

async function defaultReadStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) {
    data += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
  }
  // Strip trailing newline (one) without revealing the password length pattern.
  return data.replace(/\r?\n$/, "");
}

function extractErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as ErrorBody;
  if (typeof b.error === "string") return b.error;
  if (b.detail && typeof b.detail === "object") {
    return b.detail.error;
  }
  if (typeof b.detail === "string") return b.detail;
  return undefined;
}

function extractErrorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as ErrorBody;
  if (b.detail && typeof b.detail === "object" && b.detail.detail) {
    return b.detail.detail;
  }
  if (typeof b.detail === "string") return b.detail;
  return undefined;
}

export async function runAuthAcceptInvite(
  _config: IxConfig,
  token: string,
  opts: AcceptInviteOptions,
  deps?: AcceptInviteDeps,
): Promise<void> {
  const _raw = deps?.kubectlRaw ?? kubectlRaw;
  const _readStdin = deps?.readStdin ?? defaultReadStdin;
  const _generate = deps?.generatePassword ?? defaultGeneratePassword;
  // NFR-001: src cannot write to process.stderr directly. The default sink
  // appends the disclosure as a Listing Note (operator opted in via
  // --show-generated); tests inject an in-memory buffer.
  const generatedDisclosures: string[] = [];
  const _writeStderr =
    deps?.writeStderr ?? ((s: string) => generatedDisclosures.push(s));

  // Mutually exclusive flag combinations (FR-040-AC-1)
  const modes = [opts.passwordStdin, opts.generate].filter(Boolean).length;
  if (modes !== 1) {
    const msg =
      "Exactly one of --password-stdin or --generate is required (auth/FR-008-CON-11 forbids --password in argv).";
    await renderFailure(msg);
    throw new Error(msg);
  }

  let password: string;
  let generated = false;
  if (opts.passwordStdin) {
    password = await _readStdin();
    if (!password) {
      const msg = "stdin was empty; expected a password.";
      await renderFailure(msg);
      throw new Error(msg);
    }
  } else {
    password = _generate();
    generated = true;
  }

  let resp: AcceptInviteResponse;
  try {
    const { status, body } = await _raw<AcceptInviteResponse | ErrorBody>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/internal/users/accept-invite"),
      "POST",
      { invite_token: token, password },
    );

    if (status === 200 || status === 201) {
      resp = body as AcceptInviteResponse;
    } else {
      const code = extractErrorCode(body);
      const detail = extractErrorDetail(body);
      if (status === 400 && code === "invalid_token") {
        throw new Error(
          "Invite token is invalid, consumed, superseded, or expired.",
        );
      }
      if (status === 400 && code === "password_policy") {
        throw new Error(
          detail ?? "Password policy violation (see identity FR-032-CON-3).",
        );
      }
      if (status === 403 && code === "admin_not_acceptable_headlessly") {
        throw new Error(
          "Admin invitations must use the cloud-manager-ui browser flow per FR-008-CON-1.",
        );
      }
      if (status === 410 && code === "token_rate_limited") {
        throw new Error(
          "This token has been attempted too many times; request a fresh invite.",
        );
      }
      if (status === 429) {
        throw new Error("Rate-limited; retry after `Retry-After` seconds.");
      }
      if (status === 500 && code === "no_default_tenant") {
        throw new Error(
          "Legacy user without a default tenant; run `ix local auth tenant set-default <email>` first.",
        );
      }
      throw new Error(
        `accept-invite failed (HTTP ${status}): ${code ?? "unknown_error"}`,
      );
    }
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
      pre={<FlowLine>{`Accepting invite for ${blue(resp.user_id)}`}</FlowLine>}
      tail="Invite accepted."
    >
      <Info name="User" description={blue(resp.user_id)} />
      <Info name="Tenant" description={blue(resp.tenant_id)} />
      {resp.must_rotate && (
        <Note>
          Account is in must_rotate state; rotate before normal sign-in.
        </Note>
      )}
    </Listing>,
  );

  // Generated-password disclosure SHALL only be emitted on explicit
  // --show-generated. Routes through the injectable sink so tests can capture
  // it; the default sink emits a second Listing rather than touching
  // process.stderr directly (NFR-001).
  if (generated && opts.showGenerated) {
    _writeStderr(`Generated password: ${password}\n`);
    if (generatedDisclosures.length > 0) {
      await renderStatic(
        <Listing
          header={HEADER}
          status="passed"
          tail="Generated credential disclosed (capture this value now)."
          tailVariant="warn"
        >
          <Note>{generatedDisclosures.join("")}</Note>
        </Listing>,
      );
    }
  }
}
