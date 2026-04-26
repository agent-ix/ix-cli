import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchByTopic } from "../src/registry/github.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => vi.clearAllMocks());

describe("searchByTopic", () => {
  it("returns RepoEntry array from search results", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            name: "fastapi-cookiecutter",
            description: "FastAPI microservice template",
            html_url: "https://github.com/agent-ix/fastapi-cookiecutter",
          },
        ],
      }),
    });

    const result = await searchByTopic("agent-ix");

    expect(result).toEqual([
      {
        name: "fastapi-cookiecutter",
        description: "FastAPI microservice template",
        url: "https://github.com/agent-ix/fastapi-cookiecutter",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("topic:ix-element+org:agent-ix"),
      expect.any(Object),
    );
  });

  it("coerces null description to empty string", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            name: "my-element",
            description: null,
            html_url: "https://github.com/org/my-element",
          },
        ],
      }),
    });

    const result = await searchByTopic("org");
    expect(result[0].description).toBe("");
  });

  it("returns empty array when items is empty", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });

    expect(await searchByTopic("agent-ix")).toEqual([]);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(searchByTopic("agent-ix")).rejects.toThrow(
      "GitHub topic search failed for org 'agent-ix': 403 Forbidden",
    );
  });
});
