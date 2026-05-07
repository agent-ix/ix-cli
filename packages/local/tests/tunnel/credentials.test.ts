/**
 * TC-413–TC-415: Cloudflare tunnel credential cascade.
 *   FR-038 (Cloudflare tunnel opt-in exposure).
 *
 * Mirrors the GHCR cascade tests in credentials.test.ts but for the
 * `local.cloudflare-tunnel-token` secret.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_VAR = "IX_CF_TUNNEL_TOKEN";

beforeEach(() => {
  vi.resetModules();
  delete process.env[ENV_VAR];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env[ENV_VAR];
});

describe("resolveCloudflareToken", () => {
  it("TC-413: env var IX_CF_TUNNEL_TOKEN takes precedence over backend", async () => {
    process.env[ENV_VAR] = "from-env";
    vi.doMock("@agent-ix/ix-cli-core", () => ({
      defaultSecretsService: () => ({
        get: async () => "from-backend",
      }),
    }));
    const { resolveCloudflareToken } =
      await import("../../src/tunnel/credentials.js");
    expect(await resolveCloudflareToken()).toBe("from-env");
  });

  it("TC-414: falls through to SecretsService when env unset", async () => {
    vi.doMock("@agent-ix/ix-cli-core", () => ({
      defaultSecretsService: () => ({
        get: async (id: string) =>
          id === "local.cloudflare-tunnel-token" ? "from-backend" : null,
      }),
    }));
    const { resolveCloudflareToken } =
      await import("../../src/tunnel/credentials.js");
    expect(await resolveCloudflareToken()).toBe("from-backend");
  });

  it("TC-415: returns null when neither env nor backend has a token", async () => {
    vi.doMock("@agent-ix/ix-cli-core", () => ({
      defaultSecretsService: () => ({ get: async () => null }),
    }));
    const { resolveCloudflareToken, requireCloudflareToken } =
      await import("../../src/tunnel/credentials.js");
    expect(await resolveCloudflareToken()).toBeNull();
    await expect(requireCloudflareToken()).rejects.toThrow(
      /IX_CF_TUNNEL_TOKEN/,
    );
  });
});
