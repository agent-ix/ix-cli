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

import { isCancel, log, password } from "@agent-ix/ix-ui-cli";
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

/**
 * Resolve the GHCR token. Per FR-011 / FR-014:
 *
 * 1. Canonical env binding `IX_GHCR_TOKEN` (handled inside
 *    `SecretsService.get` via the `local.ghcr-token` declaration).
 * 2. Compatibility env vars (`GITHUB_TOKEN`, `GH_TOKEN`, `GHCR_TOKEN`,
 *    `CR_PAT`).
 * 3. SecretsService backend (keyring / age-file).
 * 4. Interactive prompt → persists via `SecretsService.set` (no
 *    plaintext file written; the value lands in the active backend).
 *
 * @param forcePrompt — bypass backend lookup and re-prompt.
 */
export async function resolveGhcrToken(forcePrompt = false): Promise<string> {
  const svc = defaultSecretsService();

  if (!forcePrompt) {
    // SecretsService.get honors the IX_GHCR_TOKEN binding internally,
    // so this single call covers env + backend in one shot.
    const stored = await svc.get(SECRET_ID);
    if (stored) return stored;
  }

  // Compatibility env vars (NOT declared on the secret schema, so
  // `SecretsService.get` does NOT see them — we honor them here for
  // CI invocations that already set GITHUB_TOKEN/GH_TOKEN/etc.).
  const fallback = resolveFallbackEnvToken();
  if (fallback && !forcePrompt) return fallback;

  log.info(
    [
      "To pull charts and images from GHCR, a GitHub Personal Access Token",
      "with read:packages scope is required.",
      "",
      "Create one at: https://github.com/settings/tokens",
      "",
      `The token will be stored via 'ix secrets' (active backend = ${await svc.activeBackendId()}).`,
    ].join("\n"),
  );
  const token = await password({
    message: "Paste your token:",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Token cannot be empty";
      }
      return undefined;
    },
  });

  if (isCancel(token)) {
    throw new CredentialsError("Credential prompt cancelled");
  }

  const trimmed = (token as string).trim();
  await svc.set(SECRET_ID, trimmed);
  return trimmed;
}
