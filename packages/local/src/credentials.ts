import { readCredentials } from "@agent-ix/ix-cli-core";

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
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
 * Resolve the GHCR token using the unified ix credential contract:
 *   1. Supported env vars (`IX_GHCR_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`, `GHCR_TOKEN`, `CR_PAT`)
 *   2. core GitHub credential in `~/.config/ix/credentials.json`
 */
export async function resolveGhcrToken(_forcePrompt = false): Promise<string> {
  // FR-011-AC-4: env var takes absolute priority, file not touched.
  const envToken = resolveEnvToken();
  if (envToken) {
    return envToken;
  }

  const token = readCredentials().githubToken?.trim();
  if (token) return token;

  throw new CredentialsError(
    "Missing GitHub credentials. Run `ix login --github` or set IX_GHCR_TOKEN.",
  );
}
