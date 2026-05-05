import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
  applySecretContract,
  loadSecretContract,
  loadSecretContractFromTgz,
} from "../src/local-secrets.js";

vi.mock("execa", async () => {
  const actual = await vi.importActual<typeof import("execa")>("execa");
  return {
    ...actual,
    execa: vi.fn(
      (file: string, args: readonly string[] = [], options?: unknown) => {
        if (file === "kubectl") {
          return Promise.resolve({ stdout: "", stderr: "", all: "" });
        }
        return actual.execa(file, args as string[], options as never);
      },
    ),
  };
});

const mockExeca = vi.mocked(execa);

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("local secret contracts", () => {
  it("returns null when a packaged chart has no ix-local.secrets.yaml", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-secrets-chart-"));
    try {
      const chartDir = path.join(dir, "plain-service");
      fs.mkdirSync(chartDir, { recursive: true });
      fs.writeFileSync(
        path.join(chartDir, "Chart.yaml"),
        "apiVersion: v2\nname: plain-service\nversion: 0.1.0\n",
      );
      const tgzPath = path.join(dir, "plain-service-0.1.0.tgz");
      await execa("tar", ["-czf", tgzPath, "-C", dir, "plain-service"]);

      await expect(
        loadSecretContractFromTgz(tgzPath, "plain-service"),
      ).resolves.toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads a packaged ix-local.secrets.yaml from a chart tgz", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-secrets-chart-"));
    try {
      const chartDir = path.join(dir, "npm-proxy");
      fs.mkdirSync(chartDir, { recursive: true });
      fs.writeFileSync(
        path.join(chartDir, "ix-local.secrets.yaml"),
        [
          "secrets:",
          "  - name: npm-proxy-github",
          "    namespace: platform",
          "    keys:",
          "      - secretKey: GH_TOKEN",
          "        env: GITHUB_TOKEN",
          "        required: true",
          "",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(chartDir, "Chart.yaml"),
        "apiVersion: v2\nname: npm-proxy\nversion: 0.1.5\n",
      );
      const tgzPath = path.join(dir, "npm-proxy-0.1.5.tgz");
      await execa("tar", ["-czf", tgzPath, "-C", dir, "npm-proxy"]);

      process.env.GITHUB_TOKEN = "from-env";
      const contract = await loadSecretContractFromTgz(tgzPath, "npm-proxy");
      expect(contract).not.toBeNull();
      expect(contract?.secrets).toHaveLength(1);
      expect(contract?.secrets[0].name).toBe("npm-proxy-github");
    } finally {
      delete process.env.GITHUB_TOKEN;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cleans up the extraction directory when tgz extraction fails", async () => {
    const before = new Set(
      fs
        .readdirSync(os.tmpdir())
        .filter((entry) => entry.startsWith("ix-secrets-extract-")),
    );

    await expect(
      loadSecretContractFromTgz("/tmp/does-not-exist.tgz", "missing"),
    ).rejects.toThrow();

    const leaked = fs
      .readdirSync(os.tmpdir())
      .filter(
        (entry) =>
          entry.startsWith("ix-secrets-extract-") && !before.has(entry),
      );
    expect(leaked).toEqual([]);
  });

  it("reuses existing generated secret keys instead of rotating them", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-secrets-test-"));
    try {
      fs.writeFileSync(
        path.join(dir, "ix-local.secrets.yaml"),
        [
          "secrets:",
          "  - name: app-secret",
          "    keys:",
          "      - secretKey: STABLE_KEY",
          "        generate: randomHex32",
          "        required: true",
          "",
        ].join("\n"),
      );
      mockExeca
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ data: { STABLE_KEY: b64("old-value") } }),
        } as never)
        .mockResolvedValueOnce({} as never);

      const contract = await loadSecretContract(dir);
      expect(contract).not.toBeNull();
      await applySecretContract(contract!, "apps");

      expect(mockExeca).toHaveBeenNthCalledWith(1, "kubectl", [
        "get",
        "secret",
        "app-secret",
        "-n",
        "apps",
        "-o",
        "json",
      ]);
      expect(mockExeca).toHaveBeenNthCalledWith(
        2,
        "kubectl",
        ["apply", "-f", "-"],
        expect.objectContaining({
          input: expect.stringContaining(`STABLE_KEY: ${b64("old-value")}`),
        }),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
