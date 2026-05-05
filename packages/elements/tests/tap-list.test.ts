/**
 * TC-077: FR-012-AC-6 — tap list marks the root tap with "(root)"
 * TC-078: FR-010-AC-4 — empty element list directs user to add a tap
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("../src/tap-config.js");
vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());
vi.mock("../src/registry/resolver.js");

import { loadTapConfig, ROOT_TAP } from "../src/tap-config.js";
import * as ui from "@agent-ix/ix-ui-cli";
import { resolveAllElements } from "../src/registry/resolver.js";
import { runTapList } from "../src/commands/tap/list.js";
import { runElementsList } from "../src/commands/list.js";

const mockLoadTapConfig = vi.mocked(loadTapConfig);
const mockResolveAll = vi.mocked(resolveAllElements);
const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;

beforeEach(() => {
  vi.clearAllMocks();
  resetListings();
});

describe("runTapList — root tap marker", () => {
  it("TC-077: passes (root) description for the root tap", async () => {
    mockLoadTapConfig.mockReturnValue({
      taps: [ROOT_TAP, "github.com/other-org"],
    });

    await runTapList();

    expect(calls).toHaveLength(1);
    const items = calls[0].items;
    expect(items).toContainEqual({ name: ROOT_TAP, description: "(root)" });
    expect(items).toContainEqual({
      name: "github.com/other-org",
      description: undefined,
    });
  });
});

describe("runElementsList — empty state", () => {
  it("TC-078: directs user to add a tap when no elements found", async () => {
    mockResolveAll.mockResolvedValue([]);

    await runElementsList();

    expect(calls).toHaveLength(1);
    expect(calls[0].tail).toEqual(
      expect.stringContaining("ix elements tap add"),
    );
  });
});
