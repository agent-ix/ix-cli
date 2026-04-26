/**
 * FR-011 — Registry Credential Storage and Loading
 * XDG-aware credential file, @clack/prompts password() prompt, IX_GHCR_TOKEN override.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { log, password, isCancel } from "@agent-ix/ix-ui-cli";

const CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
  "ix-local",
);
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

interface CredentialsSchema {
  ghcr_token: string;
}

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
}

function readCredentialsFile(): string | null {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
  } catch (err) {
    // M1: Distinguish unreadable file (permission/IO) from parse failure.
    // An unreadable file is a hard error — re-prompting would silently
    // overwrite credentials the user can't see.
    throw new CredentialsError(
      `Cannot read credentials file at ${CREDENTIALS_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const parsed = JSON.parse(raw) as CredentialsSchema;
    if (!parsed.ghcr_token || typeof parsed.ghcr_token !== "string") {
      return null; // FR-011-AC-5: missing field treated as absent
    }
    return parsed.ghcr_token;
  } catch {
    return null; // FR-011-AC-5: invalid JSON treated as absent
  }
}

function writeCredentialsFile(token: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const content = JSON.stringify({ ghcr_token: token }, null, 2);
  // C3: writeFileSync({ mode: 0o600 }) only sets mode on create. Unlink any
  // pre-existing file first so the new file is created fresh with 0600, then
  // chmod defensively in case the umask widened it.
  try {
    fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // file did not exist — fine
  }
  fs.writeFileSync(CREDENTIALS_FILE, content, { mode: 0o600 }); // FR-011-AC-2
  fs.chmodSync(CREDENTIALS_FILE, 0o600);
}

function resolveEnvToken(): string | null {
  const envNames = [
    "IX_GHCR_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GHCR_TOKEN",
    "CR_PAT",
  ] as const;

  for (const envName of envNames) {
    const token = process.env[envName]?.trim();
    if (token) {
      return token;
    }
  }

  return null;
}

/**
 * Resolve the GHCR token using priority order (FR-011):
 *   1. Supported env vars (`IX_GHCR_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`, `GHCR_TOKEN`, `CR_PAT`)
 *   2. credentials file
 *   3. Interactive prompt (persists to file)
 *
 * @param forcePrompt — if true, skip file read and re-prompt (FR-007-AC-7)
 */
export async function resolveGhcrToken(forcePrompt = false): Promise<string> {
  // FR-011-AC-4: env var takes absolute priority, file not touched.
  const envToken = resolveEnvToken();
  if (envToken) {
    return envToken;
  }

  // FR-011-AC-3: load from file on subsequent runs (unless forced)
  if (!forcePrompt) {
    const stored = readCredentialsFile();
    if (stored) {
      return stored;
    }
  }

  // FR-011-AC-1 / FR-011-AC-6: interactive prompt, input masked with • by
  // @clack/prompts PasswordPrompt for both typed and pasted characters.
  log.info(
    [
      "To pull charts and images from GHCR, a GitHub Personal Access Token",
      "with read:packages scope is required.",
      "",
      "Create one at: https://github.com/settings/tokens",
      "",
      `The token will be saved to ${CREDENTIALS_FILE}.`,
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

  // M2: Throw instead of process.exit(1) so the caller can render its outro
  // and the function is testable in isolation.
  if (isCancel(token)) {
    throw new CredentialsError("Credential prompt cancelled");
  }

  const trimmed = (token as string).trim();
  writeCredentialsFile(trimmed);
  return trimmed;
}
