import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
  applySecretContract,
  loadSecretContract,
} from "../src/local-secrets.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

const mockExeca = vi.mocked(execa);

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("local secret contracts", () => {
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
