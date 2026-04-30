import { describe, it, expect } from "vitest";
import { findDeployable, DeployableNotFoundError } from "../src/registry.js";
import type { Deployable } from "../src/discovery.js";

const makeDeployable = (name: string): Deployable => ({
  name,
  chartRepository: `agent-ix/${name}`,
  version: "1.0.0",
  role: "service",
  title: null,
  category: null,
  tags: [],
  source: null,
  entry: null,
});

describe("findDeployable", () => {
  it("returns the matching deployable", () => {
    const registry = [makeDeployable("auth"), makeDeployable("cloud-manager")];
    expect(findDeployable(registry, "auth").name).toBe("auth");
  });

  it("throws DeployableNotFoundError with name and known list when not found", () => {
    const registry = [makeDeployable("auth"), makeDeployable("cloud-manager")];
    expect(() => findDeployable(registry, "cloud-manager-ui")).toThrow(
      DeployableNotFoundError,
    );
    expect(() => findDeployable(registry, "cloud-manager-ui")).toThrow(
      "No deployable named 'cloud-manager-ui' in registry",
    );
    expect(() => findDeployable(registry, "cloud-manager-ui")).toThrow(
      "auth, cloud-manager",
    );
  });

  it("throws DeployableNotFoundError with empty known list when registry is empty", () => {
    expect(() => findDeployable([], "anything")).toThrow(
      "No deployable named 'anything' in registry. Known: ",
    );
  });
});
