/**
 * TC-430–TC-435: first-run setup helper + setTunnelBaseDomain.
 *   FR-038 (Cloudflare tunnel exposure).
 *
 * `firstRunSetup` is the only path that prompts. These tests pin the
 * TTY-gated branching, the persistence side-effects, and the
 * convenience setter `setTunnelBaseDomain`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_VAR = "IX_CF_TUNNEL_TOKEN";
let dir: string;

function seedLocalYaml(content: string): void {
  const target = join(dir, "ix", "config.d");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  writeFileSync(join(target, "local.yaml"), content, { mode: 0o600 });
}

function readLocalYaml(): string {
  return readFileSync(join(dir, "ix", "config.d", "local.yaml"), "utf8");
}

beforeEach(async () => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "ix-tunnel-firstrun-"));
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env[ENV_VAR];
  const { _resetRegistryForTests } = await import("@agent-ix/ix-cli-core");
  _resetRegistryForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env[ENV_VAR];
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("firstRunSetup", () => {
  it("TC-430: non-TTY with no token throws actionable error (CI-safe)", async () => {
    vi.doMock("@agent-ix/ix-cli-core", async () => {
      const real = await vi.importActual<
        typeof import("@agent-ix/ix-cli-core")
      >("@agent-ix/ix-cli-core");
      return {
        ...real,
        defaultSecretsService: () => ({
          get: async () => null,
          set: async () => undefined,
          activeBackendId: async () => "keyring",
        }),
      };
    });
    const { firstRunSetup } = await import("../../src/tunnel/credentials.js");
    await expect(firstRunSetup({ isTTY: false })).rejects.toThrow(
      /no TTY — refusing to prompt/,
    );
  });

  it("TC-431: non-TTY with token already set returns without prompting", async () => {
    process.env[ENV_VAR] = "from-env";
    vi.doMock("@agent-ix/ix-cli-core", async () => {
      const real = await vi.importActual<
        typeof import("@agent-ix/ix-cli-core")
      >("@agent-ix/ix-cli-core");
      return {
        ...real,
        defaultSecretsService: () => ({
          get: async () => null,
          set: async () => undefined,
          activeBackendId: async () => "keyring",
        }),
      };
    });
    const { firstRunSetup } = await import("../../src/tunnel/credentials.js");
    const promptToken = vi.fn();
    const promptBaseDomain = vi.fn();
    const result = await firstRunSetup({
      isTTY: false,
      promptToken,
      promptBaseDomain,
    });
    expect(result.token).toBe("from-env");
    expect(result.baseDomain).toBe("agent-ix.dev");
    expect(promptToken).not.toHaveBeenCalled();
    expect(promptBaseDomain).not.toHaveBeenCalled();
  });

  it("TC-432: TTY prompts for token + base domain, persists both", async () => {
    const stored: Record<string, string> = {};
    vi.doMock("@agent-ix/ix-cli-core", async () => {
      const real = await vi.importActual<
        typeof import("@agent-ix/ix-cli-core")
      >("@agent-ix/ix-cli-core");
      return {
        ...real,
        defaultSecretsService: () => ({
          get: async (id: string) => stored[id] ?? null,
          set: async (id: string, v: string) => {
            stored[id] = v;
          },
          activeBackendId: async () => "keyring",
        }),
      };
    });
    const { firstRunSetup } = await import("../../src/tunnel/credentials.js");
    const promptToken = vi.fn(async () => "captured-token");
    const promptBaseDomain = vi.fn(async () => "demo.example.com");
    const result = await firstRunSetup({
      isTTY: true,
      promptToken,
      promptBaseDomain,
    });
    expect(result).toEqual({
      token: "captured-token",
      baseDomain: "demo.example.com",
    });
    expect(stored["local.cloudflare-tunnel-token"]).toBe("captured-token");
    expect(readLocalYaml()).toContain("baseDomain: demo.example.com");
  });

  it("TC-433: idempotent — both already configured returns without prompting", async () => {
    process.env[ENV_VAR] = "from-env";
    seedLocalYaml("tunnel:\n  baseDomain: my.tunnel.dev\n");
    vi.doMock("@agent-ix/ix-cli-core", async () => {
      const real = await vi.importActual<
        typeof import("@agent-ix/ix-cli-core")
      >("@agent-ix/ix-cli-core");
      return {
        ...real,
        defaultSecretsService: () => ({
          get: async () => null,
          set: async () => undefined,
          activeBackendId: async () => "keyring",
        }),
      };
    });
    const { firstRunSetup } = await import("../../src/tunnel/credentials.js");
    const promptToken = vi.fn();
    const promptBaseDomain = vi.fn();
    const result = await firstRunSetup({
      isTTY: true,
      promptToken,
      promptBaseDomain,
    });
    expect(result).toEqual({
      token: "from-env",
      baseDomain: "my.tunnel.dev",
    });
    expect(promptToken).not.toHaveBeenCalled();
    expect(promptBaseDomain).not.toHaveBeenCalled();
  });
});

describe("setTunnelBaseDomain", () => {
  it("TC-434: persists a valid base domain to local.yaml", async () => {
    const { setTunnelBaseDomain } =
      await import("../../src/tunnel/credentials.js");
    setTunnelBaseDomain("foo.example.com");
    expect(readLocalYaml()).toContain("baseDomain: foo.example.com");
  });

  it("TC-435: rejects an invalid base domain without writing", async () => {
    const { setTunnelBaseDomain, TunnelCredentialsError } =
      await import("../../src/tunnel/credentials.js");
    expect(() => setTunnelBaseDomain("ix")).toThrow(TunnelCredentialsError);
  });
});
