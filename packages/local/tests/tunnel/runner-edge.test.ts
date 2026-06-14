/**
 * TC-436 + AC-17/AC-18 unit coverage that doesn't need a live cluster:
 *
 *   - TC-436: `ix tunnel domain` read prints current; write persists +
 *             reports the new value with the CNAME reminder.
 *   - AC-17:  `ix tunnel expose <missing>` surfaces an actionable error
 *             pointing at `ix up <name>` (the underlying `helm get values`
 *             fails with "release: not found").
 *   - AC-18:  `runTunnelDown` is idempotent — a "release: not found"
 *             stderr from `helm uninstall` is swallowed, no throw.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeEach(async () => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "ix-tunnel-edge-"));
  mkdirSync(join(dir, "ix", "config.d"), { recursive: true, mode: 0o700 });
  process.env.XDG_CONFIG_HOME = dir;
  const { _resetRegistryForTests } =
    await import("@agent-ix/ix-cli-core");
  _resetRegistryForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("runTunnelDomainCommand (TC-436)", () => {
  it("read form prints current baseDomain", async () => {
    const { runTunnelDomainCommand } =
      await import("../../src/tunnel/runner.js");
    // No throw, no write — schema default flows through.
    await expect(runTunnelDomainCommand(null)).resolves.toBeUndefined();
  });

  it("write form persists a valid base domain", async () => {
    const { runTunnelDomainCommand } =
      await import("../../src/tunnel/runner.js");
    const { loadTunnelConfig } = await import("../../src/config.js");
    await runTunnelDomainCommand("custom.example.com");
    expect(loadTunnelConfig().baseDomain).toBe("custom.example.com");
  });

  it("write form rejects an invalid base domain", async () => {
    const { runTunnelDomainCommand } =
      await import("../../src/tunnel/runner.js");
    await expect(runTunnelDomainCommand("ix")).rejects.toThrow(
      /at least two labels/,
    );
  });
});

describe("exposeApp on missing release (AC-17)", () => {
  it("surfaces an actionable `ix up <app>` hint when helm release is absent", async () => {
    vi.doMock("execa", () => ({
      execa: vi.fn(async (_cmd: string, args: readonly string[]) => {
        if (args[0] === "get" && args[1] === "values") {
          throw new Error(
            "Error: release: not found\n  release name: spec-editor",
          );
        }
        throw new Error(`unexpected execa call: ${args.join(" ")}`);
      }),
    }));
    const { exposeApp } = await import("../../src/tunnel/expose.js");
    const fakeConfig = {} as never;
    const registry = [
      {
        name: "spec-editor",
        chartRepository: "agent-ix/spec-editor",
        version: "0.10.0",
        role: "service" as const,
        title: null,
        category: null,
        tags: [],
        source: null,
        entry: null,
        namespace: "apps",
      },
    ];
    await expect(
      exposeApp("spec-editor", registry, fakeConfig, "agent-ix.dev"),
    ).rejects.toThrow(/Run `ix up spec-editor` first/);
  });
});

describe("runTunnelDown idempotency (AC-18)", () => {
  it("swallows 'release: not found' from helm uninstall", async () => {
    vi.doMock("execa", () => ({
      execa: vi.fn(async () => {
        const err = new Error(
          "Error: uninstall: Release not loaded: cloudflared: release: not found",
        );
        throw err;
      }),
    }));
    const { runTunnelDown } = await import("../../src/tunnel/install.js");
    await expect(runTunnelDown()).resolves.toBeUndefined();
  });

  it("re-throws unrelated errors unchanged", async () => {
    vi.doMock("execa", () => ({
      execa: vi.fn(async () => {
        throw new Error("connection refused: kube-apiserver unreachable");
      }),
    }));
    const { runTunnelDown } = await import("../../src/tunnel/install.js");
    await expect(runTunnelDown()).rejects.toThrow(/connection refused/);
  });
});
