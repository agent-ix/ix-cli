/**
 * TC-071–TC-076: resolveAllElements / resolveElementByType
 * FR-010 (registry resolution, AC-3 refresh, AC-4 empty state), FR-011-AC-1 (type lookup error)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/registry/cache.js");
vi.mock("../src/registry/github.js");
vi.mock("../src/tap-config.js");

import { readCache, writeCache } from "../src/registry/cache.js";
import { getGhToken, searchByTopic } from "../src/registry/github.js";
import { loadTapConfig } from "../src/tap-config.js";
import {
  resolveAllElements,
  resolveElementByType,
} from "../src/registry/resolver.js";
import type { ElementEntry } from "../src/registry/resolver.js";

const mockReadCache = vi.mocked(readCache);
const mockWriteCache = vi.mocked(writeCache);
const mockGetGhToken = vi.mocked(getGhToken);
const mockSearchByTopic = vi.mocked(searchByTopic);
const mockLoadTapConfig = vi.mocked(loadTapConfig);

const ROOT_TAP = "github.com/agent-ix";

const FASTAPI_ENTRY: ElementEntry = {
  type: "fastapi",
  name: "fastapi-cookiecutter",
  description: "FastAPI microservice template",
  repoUrl: "https://github.com/agent-ix/fastapi-cookiecutter",
  tap: ROOT_TAP,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGhToken.mockReturnValue(undefined);
  mockLoadTapConfig.mockReturnValue({ taps: [ROOT_TAP] });
});

describe("resolveAllElements — cache hit path (TC-071)", () => {
  it("TC-071: returns cached elements without fetching GitHub", async () => {
    mockReadCache.mockReturnValue([FASTAPI_ENTRY]);

    const result = await resolveAllElements();

    expect(result).toEqual([FASTAPI_ENTRY]);
    expect(mockSearchByTopic).not.toHaveBeenCalled();
    expect(mockWriteCache).not.toHaveBeenCalled();
  });
});

describe("resolveAllElements — cache miss (TC-072)", () => {
  it("TC-072: fetches via topic search, writes cache, returns elements", async () => {
    mockReadCache.mockReturnValue(null);
    mockSearchByTopic.mockResolvedValue([
      {
        name: "fastapi-cookiecutter",
        description: "FastAPI microservice template",
        url: "https://github.com/agent-ix/fastapi-cookiecutter",
      },
    ]);

    const result = await resolveAllElements();

    expect(mockSearchByTopic).toHaveBeenCalledWith("agent-ix", undefined);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(FASTAPI_ENTRY);
    expect(mockWriteCache).toHaveBeenCalledWith(ROOT_TAP, result);
  });
});

describe("resolveAllElements — type derivation", () => {
  it("strips -cookiecutter suffix to derive type", async () => {
    mockReadCache.mockReturnValue(null);
    mockSearchByTopic.mockResolvedValue([
      {
        name: "pg-data-service-cookiecutter",
        description: "",
        url: "https://github.com/agent-ix/pg-data-service-cookiecutter",
      },
    ]);

    const result = await resolveAllElements();
    expect(result[0].type).toBe("pg-data-service");
  });

  it("uses repo name as-is when no -cookiecutter suffix", async () => {
    mockReadCache.mockReturnValue(null);
    mockSearchByTopic.mockResolvedValue([
      {
        name: "my-element",
        description: "",
        url: "https://github.com/agent-ix/my-element",
      },
    ]);

    const result = await resolveAllElements();
    expect(result[0].type).toBe("my-element");
  });
});

describe("resolveAllElements — single-repo tap", () => {
  it("resolves a github.com/<org>/<repo> tap directly without search", async () => {
    mockLoadTapConfig.mockReturnValue({
      taps: ["github.com/my-org/my-element"],
    });
    mockReadCache.mockReturnValue(null);

    const result = await resolveAllElements();

    expect(mockSearchByTopic).not.toHaveBeenCalled();
    expect(result[0].type).toBe("my-element");
    expect(result[0].repoUrl).toBe("https://github.com/my-org/my-element");
    expect(result[0].tap).toBe("github.com/my-org/my-element");
  });
});

describe("resolveAllElements — refresh bypasses cache (FR-010-AC-3)", () => {
  it("does not call readCache when refresh=true", async () => {
    mockSearchByTopic.mockResolvedValue([]);

    await resolveAllElements({ refresh: true });

    expect(mockReadCache).not.toHaveBeenCalled();
  });
});

describe("resolveAllElements — empty state (FR-010-AC-4)", () => {
  it("returns empty array when topic search finds nothing", async () => {
    mockReadCache.mockReturnValue(null);
    mockSearchByTopic.mockResolvedValue([]);

    const result = await resolveAllElements();
    expect(result).toEqual([]);
  });
});

describe("resolveElementByType (TC-074, TC-075)", () => {
  it("TC-074: returns the matching element entry by type", async () => {
    mockReadCache.mockReturnValue([FASTAPI_ENTRY]);

    const result = await resolveElementByType("fastapi");
    expect(result).toEqual(FASTAPI_ENTRY);
  });

  it("TC-075: throws with helpful message for unknown type (FR-011-AC-1)", async () => {
    mockReadCache.mockReturnValue([FASTAPI_ENTRY]);

    await expect(resolveElementByType("rust-service")).rejects.toThrow(
      "Unknown element type 'rust-service'",
    );
    await expect(resolveElementByType("rust-service")).rejects.toThrow(
      "ix elements list",
    );
  });
});
