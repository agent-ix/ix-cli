import { describe, it, expect } from "vitest";
import { toSlug } from "../src/scaffold.js";

describe("toSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(toSlug("My Service")).toBe("my-service");
  });

  it("replaces underscores with hyphens", () => {
    expect(toSlug("my_service")).toBe("my-service");
  });

  it("collapses multiple hyphens", () => {
    expect(toSlug("my--service")).toBe("my-service");
  });

  it("strips path traversal sequences", () => {
    // ".." removed, "/" → "-", collapse and trim
    expect(toSlug("../../etc/passwd")).toBe("etc-passwd");
  });

  it("strips forward slashes", () => {
    expect(toSlug("org/repo")).toBe("org-repo");
  });

  it("strips backslashes", () => {
    expect(toSlug("org\\repo")).toBe("org-repo");
  });

  it("strips non-alphanumeric chars other than hyphens", () => {
    expect(toSlug("my service!@#")).toBe("my-service");
  });

  it("trims leading and trailing hyphens", () => {
    expect(toSlug("-hello-")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(toSlug("")).toBe("");
  });
});
