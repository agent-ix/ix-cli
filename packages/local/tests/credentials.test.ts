/**
 * resolveGhcrToken precedence — FR-011 / FR-014.
 *
 * The contract is: explicit settings beat implicit persisted state.
 *   1. IX_GHCR_TOKEN (canonical env binding)
 *   2. Compatibility env vars (GITHUB_TOKEN / GH_TOKEN / GHCR_TOKEN / CR_PAT)
 *   3. SecretsService backend (keyring / age-file)
 *   4. Interactive prompt (only when 1-3 yield nothing)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MemoryBackend,
  SecretsService,
  registerSecretsForPlugin,
  setDefaultSecretsService,
  resetDefaultSecretsService,
} from "@agent-ix/ix-cli-core";

import { _resetSecretsRegistryForTests } from "@agent-ix/ix-cli-core/src/secrets/registry.js";

const ENV_VARS = [
  "IX_GHCR_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GHCR_TOKEN",
  "CR_PAT",
] as const;

const saved: Partial<Record<(typeof ENV_VARS)[number], string | undefined>> =
  {};

function snapshotEnv(): void {
  for (const k of ENV_VARS) saved[k] = process.env[k];
}

function clearEnv(): void {
  for (const k of ENV_VARS) delete process.env[k];
}

function restoreEnv(): void {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

let backend: MemoryBackend;

beforeEach(() => {
  snapshotEnv();
  clearEnv();
  _resetSecretsRegistryForTests();
  registerSecretsForPlugin("local", [
    {
      name: "ghcr-token",
      description: "GHCR PAT",
      envVar: "IX_GHCR_TOKEN",
    },
  ]);
  backend = new MemoryBackend("keyring");
  setDefaultSecretsService(
    new SecretsService({
      mode: "keyring",
      backends: new Map([["keyring", backend]]),
      // Pass `undefined` so the service reads from process.env.
      env: undefined,
    }),
  );
});

afterEach(() => {
  resetDefaultSecretsService();
  _resetSecretsRegistryForTests();
  restoreEnv();
});

describe("resolveGhcrToken — precedence", () => {
  it("IX_GHCR_TOKEN beats every other source", async () => {
    process.env.IX_GHCR_TOKEN = "from-canonical-env";
    process.env.GITHUB_TOKEN = "from-fallback-env";
    await backend.set("local.ghcr-token", "from-backend");
    const { resolveGhcrToken } = await import("../src/credentials.js");
    expect(await resolveGhcrToken()).toBe("from-canonical-env");
  });

  it("GITHUB_TOKEN beats persisted backend (M1: explicit beats implicit)", async () => {
    process.env.GITHUB_TOKEN = "from-github-token";
    await backend.set("local.ghcr-token", "from-backend");
    const { resolveGhcrToken } = await import("../src/credentials.js");
    expect(await resolveGhcrToken()).toBe("from-github-token");
  });

  it("GH_TOKEN beats persisted backend", async () => {
    process.env.GH_TOKEN = "from-gh-token";
    await backend.set("local.ghcr-token", "from-backend");
    const { resolveGhcrToken } = await import("../src/credentials.js");
    expect(await resolveGhcrToken()).toBe("from-gh-token");
  });

  it("CR_PAT beats persisted backend", async () => {
    process.env.CR_PAT = "from-cr-pat";
    await backend.set("local.ghcr-token", "from-backend");
    const { resolveGhcrToken } = await import("../src/credentials.js");
    expect(await resolveGhcrToken()).toBe("from-cr-pat");
  });

  it("first compatibility env var wins (GITHUB_TOKEN > GH_TOKEN)", async () => {
    process.env.GITHUB_TOKEN = "github-wins";
    process.env.GH_TOKEN = "gh-loses";
    const { resolveGhcrToken } = await import("../src/credentials.js");
    expect(await resolveGhcrToken()).toBe("github-wins");
  });

  it("backend value used when no env var is set", async () => {
    await backend.set("local.ghcr-token", "from-backend");
    const { resolveGhcrToken } = await import("../src/credentials.js");
    expect(await resolveGhcrToken()).toBe("from-backend");
  });

  it("empty IX_GHCR_TOKEN is NOT honored (treated as unset)", async () => {
    process.env.IX_GHCR_TOKEN = "   ";
    await backend.set("local.ghcr-token", "from-backend");
    const { resolveGhcrToken } = await import("../src/credentials.js");
    expect(await resolveGhcrToken()).toBe("from-backend");
  });
});
