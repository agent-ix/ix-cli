/**
 * TC-077: FR-012-AC-6 — tap list marks the root tap with "(root)"
 * TC-078: FR-010-AC-4 — empty element list directs user to add a tap
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/tap-config.js");
vi.mock("@agent-ix/ix-ui-cli", () => {
  const success = vi.fn();
  return {
    startListing: vi.fn(() => ({
      group: vi.fn(),
      item: vi.fn(),
      note: vi.fn(),
      raw: vi.fn(),
      commit: vi.fn(),
      pause: vi.fn(),
      success,
      warn: vi.fn(),
      error: vi.fn(),
    })),
    __success: success,
  };
});
vi.mock("../src/registry/resolver.js");

import { loadTapConfig, ROOT_TAP } from "../src/tap-config.js";
import * as ui from "@agent-ix/ix-ui-cli";
import { resolveAllElements } from "../src/registry/resolver.js";
import { runTapList } from "../src/commands/tap/list.js";
import { runElementsList } from "../src/commands/list.js";

const mockLoadTapConfig = vi.mocked(loadTapConfig);
const mockStartListing = vi.mocked(ui.startListing);
const mockResolveAll = vi.mocked(resolveAllElements);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// TC-077: FR-012-AC-6
// ---------------------------------------------------------------------------
describe("runTapList — root tap marker", () => {
  it("TC-077: passes (root) description for the root tap", () => {
    mockLoadTapConfig.mockReturnValue({
      taps: [ROOT_TAP, "github.com/other-org"],
    });

    const items: Array<[string, string | undefined]> = [];
    const item = vi.fn((name: string, desc?: string) => {
      items.push([name, desc]);
    });
    mockStartListing.mockReturnValueOnce({
      group: vi.fn(),
      item,
      note: vi.fn(),
      raw: vi.fn(),
      commit: vi.fn(),
      pause: vi.fn() as never,
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    runTapList();

    expect(items).toContainEqual([ROOT_TAP, "(root)"]);
    expect(items).toContainEqual(["github.com/other-org", undefined]);
  });
});

// ---------------------------------------------------------------------------
// TC-078: FR-010-AC-4
// ---------------------------------------------------------------------------
describe("runElementsList — empty state", () => {
  it("TC-078: directs user to add a tap when no elements found", async () => {
    mockResolveAll.mockResolvedValue([]);
    const success = vi.fn();
    mockStartListing.mockReturnValueOnce({
      group: vi.fn(),
      item: vi.fn(),
      note: vi.fn(),
      raw: vi.fn(),
      commit: vi.fn(),
      pause: vi.fn() as never,
      success,
      warn: vi.fn(),
      error: vi.fn(),
    });

    await runElementsList();

    expect(success).toHaveBeenCalledWith(
      expect.stringContaining("ix elements tap add"),
    );
  });
});
