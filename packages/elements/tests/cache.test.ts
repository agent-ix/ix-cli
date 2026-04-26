import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readCache,
  writeCache,
  invalidateCache,
} from "../src/registry/cache.js";
import type { ElementEntry } from "../src/registry/resolver.js";

const SAMPLE: ElementEntry[] = [
  {
    type: "fastapi-service",
    name: "fastapi-cookiecutter",
    description: "FastAPI microservice",
    repoUrl: "https://github.com/agent-ix/fastapi-cookiecutter",
    tap: "github.com/agent-ix",
  },
];

describe("registry/cache", () => {
  beforeEach(() => {
    invalidateCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for a cold cache", () => {
    expect(readCache("github.com/agent-ix")).toBeNull();
  });

  it("round-trips elements through write/read", () => {
    writeCache("github.com/agent-ix", SAMPLE);
    const result = readCache("github.com/agent-ix");
    expect(result).toEqual(SAMPLE);
  });

  it("returns null after invalidation", () => {
    writeCache("github.com/agent-ix", SAMPLE);
    invalidateCache("github.com/agent-ix");
    expect(readCache("github.com/agent-ix")).toBeNull();
  });

  it("returns null and deletes the file when cache is expired", () => {
    vi.useFakeTimers();
    writeCache("github.com/agent-ix", SAMPLE);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000); // +2h
    expect(readCache("github.com/agent-ix")).toBeNull();
    // second read confirms file was deleted (cold cache)
    vi.useRealTimers();
    expect(readCache("github.com/agent-ix")).toBeNull();
  });

  it("invalidateCache() with no arg clears all cached taps", () => {
    writeCache("github.com/agent-ix", SAMPLE);
    writeCache("github.com/other-org", SAMPLE);
    invalidateCache();
    expect(readCache("github.com/agent-ix")).toBeNull();
    expect(readCache("github.com/other-org")).toBeNull();
  });
});
