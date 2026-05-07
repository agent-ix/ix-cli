/**
 * FR-038 — Cloudflare Tunnel credential + base-domain resolution.
 *
 * Three callers, three policies:
 *
 *   1. `resolveCloudflareToken()` — env → SecretsService → null. Pure
 *      lookup, never prompts. Used by the cluster-start auto-start
 *      hook and by `ix tunnel expose`/`unexpose` so cluster bringup
 *      and per-app exposure stay non-interactive.
 *   2. `requireCloudflareToken()` — same lookup, throws on miss.
 *      Useful when a missing token is fatal and the caller wants no
 *      prompt regardless of TTY (tests, scripted paths).
 *   3. `firstRunSetup()` — `ix tunnel up` first-run helper. On a TTY:
 *      prompts for the tunnel token AND the base domain (the wildcard
 *      hostname behind the tunnel), persists both, returns the
 *      resolved values. Off a TTY (CI, headless): throws a single
 *      actionable error pointing at `ix secrets set ...` and
 *      `ix tunnel domain <value>`. Only `ix tunnel up` invokes this.
 */

import type React from "react";
import {
  Listing,
  Note,
  PasswordPrompt,
  TextPrompt,
  render,
  renderStatic,
  useEffect,
  useRenderResult,
  useState,
} from "@agent-ix/ix-ui-cli";
import { ConfigService, defaultSecretsService } from "@agent-ix/ix-cli-core";
import {
  isValidBaseDomain,
  LocalConfigSchema,
  LocalEnvBindings,
  LOCAL_PLUGIN_ID,
} from "../schema.js";

const SECRET_ID = "local.cloudflare-tunnel-token" as const;

export class TunnelCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TunnelCredentialsError";
  }
}

const MISSING_TOKEN_MESSAGE =
  "No Cloudflare tunnel token found. Set IX_CF_TUNNEL_TOKEN or run `ix secrets set cloudflare-tunnel-token`.";

export async function resolveCloudflareToken(): Promise<string | null> {
  const env = process.env.IX_CF_TUNNEL_TOKEN?.trim();
  if (env) return env;

  const stored = await defaultSecretsService().get(SECRET_ID);
  if (stored) return stored.trim();

  return null;
}

export async function requireCloudflareToken(): Promise<string> {
  const token = await resolveCloudflareToken();
  if (!token) throw new TunnelCredentialsError(MISSING_TOKEN_MESSAGE);
  return token;
}

/** Persist a new base domain to `~/.config/ix/config.d/local.yaml`. */
export function setTunnelBaseDomain(baseDomain: string): void {
  if (!isValidBaseDomain(baseDomain)) {
    throw new TunnelCredentialsError(
      `Invalid base domain ${JSON.stringify(baseDomain)} — must be a fully-qualified domain with at least two labels (e.g. agent-ix.dev).`,
    );
  }
  const cfg = ConfigService.forPlugin(LOCAL_PLUGIN_ID, LocalConfigSchema, {
    envBindings: LocalEnvBindings,
  });
  const current = cfg.get();
  cfg.set({ tunnel: { ...current.tunnel, baseDomain } });
}

export interface FirstRunResult {
  token: string;
  baseDomain: string;
}

/**
 * Test seam — production callers leave deps blank. Tests pass
 * deterministic stubs for `isTTY`, the password prompt, and the
 * base-domain prompt.
 */
export interface FirstRunDeps {
  isTTY?: boolean;
  promptToken?: (activeBackend: string) => Promise<string | null>;
  promptBaseDomain?: (currentDefault: string) => Promise<string | null>;
}

async function defaultPromptToken(
  activeBackend: string,
): Promise<string | null> {
  await renderStatic(
    <Listing
      header="ix tunnel up: first-run setup"
      status="passed"
      tail={`Token will be stored via 'ix secrets' (active backend = ${activeBackend}).`}
    >
      <Note>
        Create a tunnel in the Cloudflare dashboard (Zero Trust → Networks
      </Note>
      <Note>→ Tunnels) and paste the issued token.</Note>
      <Note>{` `}</Note>
      <Note>{`Skip the prompt next time by exporting IX_CF_TUNNEL_TOKEN.`}</Note>
    </Listing>,
  );
  return capturePrompt((onSubmit) => (
    <PasswordPrompt
      message="Paste your Cloudflare tunnel token:"
      validate={(v) =>
        !v || v.trim().length === 0 ? "Token cannot be empty" : null
      }
      onSubmit={onSubmit}
    />
  ));
}

async function defaultPromptBaseDomain(
  currentDefault: string,
): Promise<string | null> {
  return capturePrompt((onSubmit) => (
    <TextPrompt
      message={`Wildcard hostname for the tunnel (must match the *.<host> CNAME you set in Cloudflare DNS):`}
      defaultValue={currentDefault}
      validate={(v) =>
        isValidBaseDomain(v.trim())
          ? null
          : "Must be a fully-qualified domain with at least two labels (e.g. agent-ix.dev)"
      }
      onSubmit={onSubmit}
    />
  ));
}

type SubmitResult = { ok: true; value: string } | { ok: false };

function capturePrompt(
  factory: (onSubmit: (r: SubmitResult) => void) => React.ReactElement,
): Promise<string | null> {
  let captured: string | null = null;
  let cancelled = false;
  const Capture: React.FC = () => {
    const { exit } = useRenderResult();
    const [done, setDone] = useState(false);
    useEffect(() => {
      if (done) {
        const t = setTimeout(exit, 0);
        return () => clearTimeout(t);
      }
    }, [done, exit]);
    return factory((r) => {
      if (r.ok) captured = r.value;
      else cancelled = true;
      setDone(true);
    });
  };
  return render(<Capture />).then(() => (cancelled ? null : captured));
}

/**
 * First-run setup. Resolves the token (env / SecretsService / prompt)
 * AND the base domain (config / prompt), persisting whatever the user
 * supplies. On a non-TTY this throws instead of hanging.
 *
 * Idempotent: when both values are already configured, returns them
 * without prompting.
 */
export async function firstRunSetup(
  deps: FirstRunDeps = {},
): Promise<FirstRunResult> {
  const cfg = ConfigService.forPlugin(LOCAL_PLUGIN_ID, LocalConfigSchema, {
    envBindings: LocalEnvBindings,
  });
  const tunnelCfg = cfg.get().tunnel;
  const existingToken = await resolveCloudflareToken();

  // Both already configured → no prompt, no writes.
  if (existingToken && tunnelCfg.baseDomain) {
    return { token: existingToken, baseDomain: tunnelCfg.baseDomain };
  }

  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY);
  if (!isTTY) {
    if (!existingToken) {
      throw new TunnelCredentialsError(
        `${MISSING_TOKEN_MESSAGE} (no TTY — refusing to prompt).`,
      );
    }
    // Non-TTY but token is set and baseDomain has its schema default —
    // accept the default rather than blocking.
    return { token: existingToken, baseDomain: tunnelCfg.baseDomain };
  }

  const svc = defaultSecretsService();
  let token = existingToken;
  if (!token) {
    const promptToken = deps.promptToken ?? defaultPromptToken;
    const captured = await promptToken(await svc.activeBackendId());
    if (captured === null) {
      throw new TunnelCredentialsError("Setup cancelled");
    }
    token = captured.trim();
    await svc.set(SECRET_ID, token);
  }

  const promptBaseDomain = deps.promptBaseDomain ?? defaultPromptBaseDomain;
  const captured = await promptBaseDomain(tunnelCfg.baseDomain);
  if (captured === null) {
    throw new TunnelCredentialsError("Setup cancelled");
  }
  const baseDomain = captured.trim();
  if (baseDomain !== tunnelCfg.baseDomain) {
    setTunnelBaseDomain(baseDomain);
  }

  return { token, baseDomain };
}
