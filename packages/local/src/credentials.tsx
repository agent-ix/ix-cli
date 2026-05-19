/**
 * FR-011 — GHCR Credential Resolution
 *
 * Routes through the shared `SecretsService` (FR-014). Resolution
 * order:
 *   1. Env vars (`IX_GHCR_TOKEN` is the canonical binding declared by
 *      the `local` plugin's `secretsSchema`; `GITHUB_TOKEN` /
 *      `GH_TOKEN` / `GHCR_TOKEN` / `CR_PAT` are honored as
 *      compatibility fallbacks).
 *   2. Active SecretsService backend (OS keyring or age-encrypted
 *      file fallback).
 *   3. Optional interactive prompt that persists to the active
 *      backend (no plaintext file).
 */

import type React from "react";
import {
  FlowLine,
  Listing,
  Note,
  PasswordPrompt,
  blue,
  render,
  renderStatic,
  useEffect,
  useRenderResult,
  useState,
} from "@agent-ix/ix-ui-cli";
import { defaultSecretsService } from "@agent-ix/ix-cli-core";

const FALLBACK_ENV_NAMES = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GHCR_TOKEN",
  "CR_PAT",
] as const;

const SECRET_ID = "local.ghcr-token" as const;

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
}

function resolveFallbackEnvToken(): string | null {
  for (const envName of FALLBACK_ENV_NAMES) {
    const token = process.env[envName]?.trim();
    if (token) return token;
  }
  return null;
}

async function promptForToken(activeBackend: string): Promise<string | null> {
  // FR-011: explanatory note + prompt. Render the note as a final-state
  // listing so it lands above the prompt, then drive the prompt.
  await renderStatic(
    <Listing
      header="ix local: GHCR token required"
      status="passed"
      variant="flow"
      pre={
        <FlowLine>{`Storing GHCR token via ${blue(activeBackend)}`}</FlowLine>
      }
      tail={`The token will be stored via 'ix secrets' (active backend = ${blue(activeBackend)}).`}
    >
      <Note>
        To pull charts and images from GHCR, a GitHub Personal Access Token
      </Note>
      <Note>with read:packages scope is required.</Note>
      <Note>{` `}</Note>
      <Note>Create one at: https://github.com/settings/tokens</Note>
    </Listing>,
  );

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
    return (
      <PasswordPrompt
        message="Paste your token:"
        validate={(v) =>
          !v || v.trim().length === 0 ? "Token cannot be empty" : null
        }
        onSubmit={(r) => {
          if (r.ok) captured = r.value;
          else cancelled = true;
          setDone(true);
        }}
      />
    );
  };
  await render(<Capture />);
  return cancelled ? null : captured;
}

/**
 * Resolve the GHCR token without prompting. Cluster lifecycle hooks use this
 * path so background convenience work never blocks on an interactive prompt.
 */
export async function resolveGhcrTokenNonInteractive(): Promise<string | null> {
  const ix = process.env.IX_GHCR_TOKEN?.trim();
  if (ix) return ix;

  const fallback = resolveFallbackEnvToken();
  if (fallback) return fallback;

  const stored = await defaultSecretsService().get(SECRET_ID);
  return stored?.trim() || null;
}

/**
 * Resolve the GHCR token. Per FR-011 / FR-014:
 *
 * 1. Canonical env binding `IX_GHCR_TOKEN` (declared on the secret
 *    via `local.ghcr-token.envVar` and honored by `SecretsService.get`).
 * 2. Compatibility env vars (`GITHUB_TOKEN`, `GH_TOKEN`, `GHCR_TOKEN`,
 *    `CR_PAT`). Explicit env settings ALWAYS beat persisted-backend
 *    values — a CI runner that exports any of these expects them to
 *    override whatever `ix secrets set` previously stored.
 * 3. SecretsService backend (keyring / age-file).
 * 4. Interactive prompt → persists via `SecretsService.set` (no
 *    plaintext file written; the value lands in the active backend).
 *
 * @param forcePrompt — bypass env + backend lookup and re-prompt.
 */
export async function resolveGhcrToken(forcePrompt = false): Promise<string> {
  const svc = defaultSecretsService();

  if (!forcePrompt) {
    const resolved = await resolveGhcrTokenNonInteractive();
    if (resolved) return resolved;
  }

  const token = await promptForToken(await svc.activeBackendId());
  if (token === null) {
    throw new CredentialsError("Credential prompt cancelled");
  }

  const trimmed = token.trim();
  await svc.set(SECRET_ID, trimmed);
  return trimmed;
}
