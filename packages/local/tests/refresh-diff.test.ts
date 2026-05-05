import { describe, it, expect } from "vitest";
import { diffRegistry, formatRefreshChange } from "../src/refresh-diff.js";
import type { Deployable } from "../src/discovery.js";

const make = (
  name: string,
  version: string,
  overrides: Partial<Deployable> = {},
): Deployable => ({
  name,
  chartRepository: `agent-ix/${name}`,
  version,
  role: "app",
  title: null,
  category: null,
  tags: [],
  source: null,
  entry: null,
  ...overrides,
});

describe("diffRegistry", () => {
  it("TC-303: treats every fresh entry as added when prior cache is null", () => {
    const fresh = [make("auth", "3.4.0"), make("billing", "1.2.0")];
    const out = diffRegistry(null, fresh);
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.kind === "added")).toBe(true);
  });

  it("TC-304: emits a 'changed' row when version moved", () => {
    const prior = [make("auth", "3.3.0")];
    const fresh = [make("auth", "3.4.0")];
    const out = diffRegistry(prior, fresh);
    expect(out).toEqual([
      {
        kind: "changed",
        role: "app",
        displayName: "auth",
        oldVersion: "3.3.0",
        newVersion: "3.4.0",
      },
    ]);
  });

  it("TC-305: returns empty when nothing changed", () => {
    const prior = [make("auth", "3.3.0"), make("billing", "1.2.0")];
    const fresh = [make("auth", "3.3.0"), make("billing", "1.2.0")];
    expect(diffRegistry(prior, fresh)).toEqual([]);
  });

  it("TC-306: omits charts that were removed from fresh", () => {
    const prior = [make("auth", "3.3.0"), make("legacy", "0.1.0")];
    const fresh = [make("auth", "3.3.0")];
    expect(diffRegistry(prior, fresh)).toEqual([]);
  });

  it("uses title when present, falls back to name", () => {
    const prior = [make("auth", "3.3.0", { title: "Auth" })];
    const fresh = [make("auth", "3.4.0", { title: "Auth" })];
    const out = diffRegistry(prior, fresh);
    expect(out[0].displayName).toBe("Auth");
  });

  it("falls back to name when title is empty/whitespace", () => {
    const fresh = [make("auth", "3.4.0", { title: "   " })];
    const out = diffRegistry(null, fresh);
    expect(out[0].displayName).toBe("auth");
  });
});

describe("formatRefreshChange", () => {
  it("TC-307: formats a changed row as 'role:name old -> new'", () => {
    expect(
      formatRefreshChange({
        kind: "changed",
        role: "app",
        displayName: "Auth",
        oldVersion: "3.3.0",
        newVersion: "3.4.0",
      }),
    ).toBe("app:Auth 3.3.0 -> 3.4.0");
  });

  it("TC-308: formats an added row as 'role:name (new) version'", () => {
    expect(
      formatRefreshChange({
        kind: "added",
        role: "service",
        displayName: "billing",
        oldVersion: null,
        newVersion: "1.2.0",
      }),
    ).toBe("service:billing (new) 1.2.0");
  });
});
