/**
 * FR-041 — `ix local auth rotate-password <email>`
 *
 * Two-call dance:
 *   1) auth-service `POST /token` (grant_type=password) using current
 *      credentials → rotate-scoped JWT (FR-024 / FR-022).
 *   2) identity `POST /users/me/password/rotate` with the Bearer token
 *      and new_password (FR-019).
 *
 * Both calls go through `kubectlRaw` (kubeconfig-gated) — no public ingress.
 * Passwords stay in process memory; argv carries only the email.
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

const HEADER = "ix local auth rotate-password";

type RawFn = typeof kubectlRaw;

export interface RotatePasswordDeps {
  kubectlRaw?: RawFn;
  /**
   * Read N lines from stdin. Each call yields the next pending line; tests
   * inject a deterministic sequence.
   */
  readStdinLines?: (n: number) => Promise<string[]>;
  generatePassword?: () => string;
  writeStderr?: (s: string) => void;
}

export interface RotatePasswordOptions {
  currentPasswordStdin: boolean;
  newPasswordStdin: boolean;
  generate: boolean;
  showGenerated: boolean;
}

interface TokenResponse {
  rotate_token?: string;
  access_token?: string;
  token_type?: string;
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
      tail={`auth rotate-password failed: ${msg}`}
      tailVariant="error"
    />,
  );
}

function defaultGeneratePassword(): string {
  return randomBytes(32).toString("base64").replace(/[+/=]/g, "").slice(0, 32);
}

async function defaultReadStdinLines(n: number): Promise<string[]> {
  let data = "";
  for await (const chunk of process.stdin) {
    data += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
  }
  const lines = data.split(/\r?\n/);
  // Trim a trailing empty produced by a final newline.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(0, n);
}

function extractErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as ErrorBody;
  if (typeof b.error === "string") return b.error;
  if (b.detail && typeof b.detail === "object") return b.detail.error;
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

export async function runAuthRotatePassword(
  _config: IxConfig,
  email: string,
  opts: RotatePasswordOptions,
  deps?: RotatePasswordDeps,
): Promise<void> {
  const _raw = deps?.kubectlRaw ?? kubectlRaw;
  const _readStdinLines = deps?.readStdinLines ?? defaultReadStdinLines;
  const _generate = deps?.generatePassword ?? defaultGeneratePassword;
  // NFR-001 forbids direct process.stderr writes in src; default sink buffers
  // disclosures so a final Listing can surface them after success.
  const disclosures: string[] = [];
  const _writeStderr =
    deps?.writeStderr ?? ((s: string) => disclosures.push(s));

  if (!opts.currentPasswordStdin) {
    const msg =
      "--current-password-stdin is required (passwords MUST NOT appear in argv per auth/FR-008-CON-11).";
    await renderFailure(msg);
    throw new Error(msg);
  }
  const newPwModes = [opts.newPasswordStdin, opts.generate].filter(
    Boolean,
  ).length;
  if (newPwModes !== 1) {
    const msg =
      "Exactly one of --new-password-stdin or --generate is required.";
    await renderFailure(msg);
    throw new Error(msg);
  }

  // Read stdin once: line 1 = current, line 2 = new (if requested)
  const linesNeeded = 1 + (opts.newPasswordStdin ? 1 : 0);
  const lines = await _readStdinLines(linesNeeded);
  const currentPassword = lines[0] ?? "";
  let newPassword: string;
  let generated = false;
  if (opts.newPasswordStdin) {
    newPassword = lines[1] ?? "";
  } else {
    newPassword = _generate();
    generated = true;
  }
  if (!currentPassword) {
    const msg = "stdin did not yield a current password on line 1.";
    await renderFailure(msg);
    throw new Error(msg);
  }
  if (!newPassword) {
    const msg = "no new password available.";
    await renderFailure(msg);
    throw new Error(msg);
  }

  // Step 1: auth-service /token grant_type=password → rotate_token
  let rotateToken: string;
  try {
    const { status, body } = await _raw<TokenResponse | ErrorBody>(
      IX_AUTH_NAMESPACE,
      "/api/v1/token",
      "POST",
      undefined,
      {
        deployment: "auth-service",
        port: 8000,
        form: {
          grant_type: "password",
          username: email,
          password: currentPassword,
        },
      },
    );
    if (status !== 200) {
      const code = extractErrorCode(body);
      if (status === 401) {
        throw new Error(
          "auth-service rejected the current password (HTTP 401).",
        );
      }
      throw new Error(
        `auth-service /token failed (HTTP ${status}): ${code ?? "unknown_error"}`,
      );
    }
    const tok = (body as TokenResponse).rotate_token;
    if (!tok) {
      throw new Error(
        "auth-service did not issue a rotate_token — user is not in must_rotate state. Use `ix local auth reset-user` first.",
      );
    }
    rotateToken = tok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(msg);
    throw err;
  }

  // Step 2: identity /users/me/password/rotate with Bearer
  try {
    const { status, body } = await _raw<unknown | ErrorBody>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/users/me/password/rotate"),
      "POST",
      { new_password: newPassword },
      {
        deployment: "identity",
        port: 8000,
        headers: { Authorization: `Bearer ${rotateToken}` },
      },
    );
    if (status !== 204 && status !== 200 && status !== 201) {
      const code = extractErrorCode(body);
      const detail = extractErrorDetail(body);
      if (status === 400 && code === "password_policy") {
        throw new Error(detail ?? "New password failed policy.");
      }
      throw new Error(
        `password rotate failed (HTTP ${status}): ${code ?? "unknown_error"}`,
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
      pre={<FlowLine>{`Rotating password for ${blue(email)}`}</FlowLine>}
      tail="Password rotated; must_rotate cleared."
    >
      <Info name="User" description={blue(email)} />
      {generated && opts.showGenerated && (
        <Note>Generated new password printed to stderr.</Note>
      )}
    </Listing>,
  );

  if (generated && opts.showGenerated) {
    _writeStderr(`Generated new password: ${newPassword}\n`);
    if (disclosures.length > 0) {
      await renderStatic(
        <Listing
          header={HEADER}
          status="passed"
          tail="Generated credential disclosed (capture this value now)."
          tailVariant="warn"
        >
          <Note>{disclosures.join("")}</Note>
        </Listing>,
      );
    }
  }
}
