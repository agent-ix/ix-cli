/**
 * TC-077: FR-012-AC-6 — tap list marks the root tap with "(root)"
 * TC-078: FR-010-AC-4 — empty element list directs user to add a tap
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/tap-config.js");
vi.mock("@agent-ix/ix-ui-cli");
vi.mock("../src/registry/resolver.js");

import { loadTapConfig, ROOT_TAP } from "../src/tap-config.js";
import { outroSuccess } from "@agent-ix/ix-ui-cli";
import { resolveAllElements } from "../src/registry/resolver.js";
import { runTapList } from "../src/commands/tap/list.js";
import { runElementsList } from "../src/commands/list.js";

const mockLoadTapConfig = vi.mocked(loadTapConfig);
const mockOutroSuccess = vi.mocked(outroSuccess);
const mockResolveAll = vi.mocked(resolveAllElements);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// TC-077: FR-012-AC-6
// ---------------------------------------------------------------------------
describe("runTapList — root tap marker", () => {
  it("TC-077: appends (root) suffix to the root tap entry", () => {
    mockLoadTapConfig.mockReturnValue({
      taps: [ROOT_TAP, "github.com/other-org"],
    });

    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((s: unknown) => {
        written.push(String(s));
        return true;
      });

    runTapList();

    spy.mockRestore();

    const rootLine = written.find((l) => l.includes(ROOT_TAP));
    expect(rootLine).toBeDefined();
    expect(rootLine).toContain("(root)");

    const otherLine = written.find((l) => l.includes("other-org"));
    expect(otherLine).toBeDefined();
    expect(otherLine).not.toContain("(root)");
  });
});

// ---------------------------------------------------------------------------
// TC-078: FR-010-AC-4
// ---------------------------------------------------------------------------
describe("runElementsList — empty state", () => {
  it("TC-078: directs user to add a tap when no elements found", async () => {
    mockResolveAll.mockResolvedValue([]);

    await runElementsList();

    expect(mockOutroSuccess).toHaveBeenCalledWith(
      expect.stringContaining("ix elements tap add"),
    );
  });
});
