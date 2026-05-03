import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const readCredentials = vi.fn();

vi.mock("@agent-ix/ix-cli-core", () => ({
  readCredentials,
}));

const TOKEN_ENV = [
  "IX_GHCR_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GHCR_TOKEN",
  "CR_PAT",
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of TOKEN_ENV) delete process.env[key];
});

afterEach(() => {
  for (const key of TOKEN_ENV) delete process.env[key];
});

describe("resolveGhcrToken", () => {
  it("uses supported env vars before reading core credentials", async () => {
    process.env.IX_GHCR_TOKEN = " env-token ";
    const { resolveGhcrToken } = await import("../src/credentials.js");

    await expect(resolveGhcrToken()).resolves.toBe("env-token");
    expect(readCredentials).not.toHaveBeenCalled();
  });

  it("uses the unified core GitHub token when no env token is set", async () => {
    readCredentials.mockReturnValue({
      githubToken: " core-token ",
      ixTokens: null,
    });
    const { resolveGhcrToken } = await import("../src/credentials.js");

    await expect(resolveGhcrToken()).resolves.toBe("core-token");
  });

  it("throws a login-directed error when no token is available", async () => {
    readCredentials.mockReturnValue({ githubToken: null, ixTokens: null });
    const { resolveGhcrToken, CredentialsError } =
      await import("../src/credentials.js");

    await expect(resolveGhcrToken()).rejects.toThrow(CredentialsError);
    await expect(resolveGhcrToken()).rejects.toThrow(/ix login --github/);
  });
});
