import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "ix",
  "elements-taps.yaml",
);

describe("tap-config", () => {
  let backup: string | null = null;

  beforeEach(() => {
    backup = fs.existsSync(CONFIG_PATH)
      ? fs.readFileSync(CONFIG_PATH, "utf8")
      : null;
    if (fs.existsSync(CONFIG_PATH)) fs.rmSync(CONFIG_PATH);
  });

  afterEach(() => {
    if (backup === null && fs.existsSync(CONFIG_PATH)) {
      fs.rmSync(CONFIG_PATH);
    } else if (backup !== null) {
      fs.writeFileSync(CONFIG_PATH, backup, "utf8");
    }
    vi.resetModules();
  });

  it("returns root tap when no config file exists", async () => {
    const { loadTapConfig, ROOT_TAP } = await import("../src/tap-config.js");
    const config = loadTapConfig();
    expect(config.taps).toContain(ROOT_TAP);
  });

  it("addTap adds a new tap and returns true", async () => {
    const { addTap, loadTapConfig } = await import("../src/tap-config.js");
    const added = addTap("github.com/my-org");
    expect(added).toBe(true);
    expect(loadTapConfig().taps).toContain("github.com/my-org");
  });

  it("addTap returns false for duplicate", async () => {
    const { addTap, ROOT_TAP } = await import("../src/tap-config.js");
    const added = addTap(ROOT_TAP);
    expect(added).toBe(false);
  });

  it("removeTap removes a non-root tap", async () => {
    const { addTap, removeTap, loadTapConfig } =
      await import("../src/tap-config.js");
    addTap("github.com/other-org");
    removeTap("github.com/other-org");
    expect(loadTapConfig().taps).not.toContain("github.com/other-org");
  });

  it("removeTap throws when removing root tap", async () => {
    const { removeTap, ROOT_TAP } = await import("../src/tap-config.js");
    expect(() => removeTap(ROOT_TAP)).toThrow("Cannot remove the root tap");
  });

  describe("validateTapUrl", () => {
    it("accepts org-level tap", async () => {
      const { validateTapUrl } = await import("../src/tap-config.js");
      expect(() => validateTapUrl("github.com/my-org")).not.toThrow();
    });

    it("accepts single-repo tap", async () => {
      const { validateTapUrl } = await import("../src/tap-config.js");
      expect(() =>
        validateTapUrl("github.com/my-org/my-element"),
      ).not.toThrow();
    });

    it("rejects bare domain", async () => {
      const { validateTapUrl } = await import("../src/tap-config.js");
      expect(() => validateTapUrl("github.com")).toThrow("Invalid tap URL");
    });

    it("rejects path traversal", async () => {
      const { validateTapUrl } = await import("../src/tap-config.js");
      expect(() => validateTapUrl("github.com/../etc/passwd")).toThrow(
        "Invalid tap URL",
      );
    });

    it("rejects non-github URLs", async () => {
      const { validateTapUrl } = await import("../src/tap-config.js");
      expect(() => validateTapUrl("gitlab.com/my-org")).toThrow(
        "Invalid tap URL",
      );
    });

    it("addTap rejects invalid URL before writing config", async () => {
      const { addTap } = await import("../src/tap-config.js");
      expect(() => addTap("not-a-valid-tap")).toThrow("Invalid tap URL");
      expect(fs.existsSync(CONFIG_PATH)).toBe(false);
    });
  });
});
