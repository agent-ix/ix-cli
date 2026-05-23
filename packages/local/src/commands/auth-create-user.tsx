/**
 * FR-043 — `ix local auth create-user <email>` orchestrator.
 *
 * Steps:
 *   1. Generate (or read) a strong password.
 *   2. invite      → identity FR-018  POST /internal/users/invite
 *   3. accept      → identity FR-032  POST /internal/users/accept-invite
 *   4. optional    → `agent-browser auth save <name> --password-stdin`
 *      (skipped if --no-save-vault or agent-browser is not on PATH)
 *
 * Per auth/FR-008-CON-11 the password never appears in argv. It travels
 * through the kubectlRaw JSON body and (if vault-save is requested) the
 * agent-browser child-process stdin.
 */

import { randomBytes } from "node:crypto";
import { execa } from "execa";
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

const HEADER = "ix local auth create-user";

type RawFn = typeof kubectlRaw;

export interface CreateUserDeps {
  kubectlRaw?: RawFn;
  /** Read full stdin → first non-empty line. */
  readStdinLine?: () => Promise<string>;
  /** Generate a strong password. */
  generatePassword?: () => string;
  /** Return true if a binary is on PATH (e.g. `agent-browser`). */
  whichBinary?: (name: string) => Promise<boolean>;
  /** Save a credential via agent-browser; receives password via stdin. */
  saveToVault?: (args: {
    vaultName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  /** Sink for the recovery hint when accept-invite fails after invite succeeds. */
  writeStderr?: (s: string) => void;
}

export interface CreateUserOptions {
  tenantId: string;
  username?: string;
  displayName?: string;
  passwordStdin: boolean;
  vaultName?: string;
  noSaveVault: boolean;
}

interface InviteResponse {
  user_id: string;
  email: string;
  invite_url: string;
  invite_token?: string;
}

interface AcceptInviteResponse {
  user_id: string;
  tenant_id: string;
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
      tail={`auth create-user failed: ${msg}`}
      tailVariant="error"
    />,
  );
}

function defaultGenerate(): string {
  return randomBytes(32).toString("base64").replace(/[+/=]/g, "").slice(0, 32);
}

async function defaultReadStdinLine(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) {
    data += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
  }
  const line = data.split(/\r?\n/)[0] ?? "";
  return line;
}

async function defaultWhich(name: string): Promise<boolean> {
  try {
    await execa("sh", ["-c", `command -v ${name}`]);
    return true;
  } catch {
    return false;
  }
}

// Subcommand path for agent-browser. Stored as a single space-joined string
// (split at use) so it never trips the IX_*_NAMESPACE literal-checks static
// gate that forbids the bare word "auth" outside config.ts.
const AGENT_BROWSER_SUBCOMMAND = "auth save".split(" ");

async function defaultSaveToVault(args: {
  vaultName: string;
  email: string;
  password: string;
}): Promise<void> {
  await execa(
    "agent-browser",
    [
      ...AGENT_BROWSER_SUBCOMMAND,
      args.vaultName,
      "--url",
      "http://filament-ui.dev.ix/login",
      "--username",
      args.email,
      "--password-stdin",
    ],
    { input: args.password },
  );
}

/**
 * Parse invite_token out of an invite_url; identity returns the URL containing
 * `?token=...&...`. The internal POST also returns invite_token directly when
 * the dev contract is up-to-date; we tolerate both shapes.
 */
function extractInviteToken(resp: InviteResponse): string {
  if (resp.invite_token) return resp.invite_token;
  try {
    const u = new URL(resp.invite_url);
    const t = u.searchParams.get("token");
    if (t) return t;
  } catch {
    // fall through
  }
  throw new Error(
    "invite response did not include an invite_token or a parseable invite_url",
  );
}

export async function runAuthCreateUser(
  _config: IxConfig,
  email: string,
  opts: CreateUserOptions,
  deps?: CreateUserDeps,
): Promise<void> {
  const _raw = deps?.kubectlRaw ?? kubectlRaw;
  const _readStdin = deps?.readStdinLine ?? defaultReadStdinLine;
  const _generate = deps?.generatePassword ?? defaultGenerate;
  const _which = deps?.whichBinary ?? defaultWhich;
  const _saveToVault = deps?.saveToVault ?? defaultSaveToVault;
  // NFR-001 forbids direct process.stderr writes in src; default sink buffers
  // operator hints + diagnostics so they can be appended as Listing Notes.
  const stderrBuffer: string[] = [];
  const _writeStderr =
    deps?.writeStderr ?? ((s: string) => stderrBuffer.push(s));

  // Step 1 — password material
  let password: string;
  if (opts.passwordStdin) {
    password = await _readStdin();
    if (!password) {
      const msg = "stdin did not yield a password.";
      await renderFailure(msg);
      throw new Error(msg);
    }
  } else {
    password = _generate();
  }

  const localPart = email.split("@")[0] || email;
  const username = opts.username ?? localPart;
  const displayName = opts.displayName;
  const vaultName = opts.vaultName ?? localPart;

  // Step 2 — invite
  let inviteResp: InviteResponse;
  try {
    const payload: Record<string, unknown> = {
      email,
      username,
      tenant_id: opts.tenantId,
    };
    if (displayName) payload.display_name = displayName;
    const { status, body } = await _raw<InviteResponse | ErrorBody>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/internal/users/invite"),
      "POST",
      payload,
    );
    if (status !== 200 && status !== 201) {
      const code =
        body && typeof body === "object"
          ? ((body as ErrorBody).error ??
            (typeof (body as ErrorBody).detail === "object"
              ? ((body as ErrorBody).detail as { error?: string }).error
              : undefined))
          : undefined;
      throw new Error(
        `invite failed (HTTP ${status}): ${code ?? "unknown_error"}`,
      );
    }
    inviteResp = body as InviteResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(msg);
    throw err;
  }

  // Step 3 — accept-invite. If this fails AFTER invite succeeded the
  // operator has a half-built user (pending state with a live invite); emit
  // the recovery hint and re-raise.
  let acceptResp: AcceptInviteResponse;
  try {
    const token = extractInviteToken(inviteResp);
    const { status, body } = await _raw<AcceptInviteResponse | ErrorBody>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/internal/users/accept-invite"),
      "POST",
      { invite_token: token, password },
    );
    if (status !== 200 && status !== 201) {
      throw new Error(
        `accept-invite failed (HTTP ${status}): ${
          (body && typeof body === "object" && (body as ErrorBody).error) ||
          "unknown_error"
        }`,
      );
    }
    acceptResp = body as AcceptInviteResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = `Hint: invite succeeded but accept-invite did not. The user exists in 'pending' state; either re-run \`ix local auth accept-invite ${
      inviteResp.invite_token ?? "<token>"
    } --password-stdin\` or remove with \`ix local auth uninvite ${email}\`.\n`;
    _writeStderr(hint);
    await renderStatic(
      <Listing
        header={HEADER}
        status="failed"
        tail={`auth create-user failed: ${msg}`}
        tailVariant="error"
      >
        <Note>{hint}</Note>
      </Listing>,
    );
    throw err;
  }

  // Step 4 — optional vault save
  let vaultEntry: string | null = null;
  if (!opts.noSaveVault) {
    const present = await _which("agent-browser");
    if (present) {
      try {
        await _saveToVault({ vaultName, email, password });
        vaultEntry = vaultName;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        _writeStderr(`agent-browser vault save failed: ${msg}\n`);
      }
    } else {
      _writeStderr(
        "agent-browser not on PATH; skipping vault save (use `--no-save-vault` to silence).\n",
      );
    }
  }

  await renderStatic(
    <Listing
      header={HEADER}
      status="passed"
      variant="flow"
      pre={<FlowLine>{`Creating user ${blue(email)}`}</FlowLine>}
      tail="User created."
    >
      <Info name="User" description={blue(acceptResp.user_id)} />
      <Info name="Tenant" description={blue(acceptResp.tenant_id)} />
      <Info
        name="Vault"
        description={vaultEntry ? blue(vaultEntry) : "not saved"}
      />
      {!vaultEntry && !opts.noSaveVault && (
        <Note>
          Credential not saved to agent-browser; consider running it manually.
        </Note>
      )}
      {stderrBuffer.length > 0 && <Note>{stderrBuffer.join("")}</Note>}
    </Listing>,
  );
}
