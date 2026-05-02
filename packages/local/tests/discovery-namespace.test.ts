import { describe, it, expect } from "vitest";

import {
  IX_APPS_NAMESPACE,
  IX_AUTH_NAMESPACE,
  IX_PLATFORM_NAMESPACE,
  IX_SYSTEM_NAMESPACE,
} from "../src/config.js";
import {
  resolveDeployableNamespace,
  type Deployable,
} from "../src/discovery.js";

const baseDeployable: Deployable = {
  name: "placeholder",
  chartRepository: "agent-ix/placeholder",
  version: "0.0.0",
  role: "service",
  title: null,
  category: null,
  tags: [],
  source: null,
  entry: null,
  namespace: null,
};

describe("namespace constants — four-tier contract", () => {
  it("system / auth / platform / apps have the values the spec requires", () => {
    expect(IX_SYSTEM_NAMESPACE).toBe("system");
    expect(IX_AUTH_NAMESPACE).toBe("auth");
    expect(IX_PLATFORM_NAMESPACE).toBe("platform");
    expect(IX_APPS_NAMESPACE).toBe("apps");
  });
});

describe("resolveDeployableNamespace", () => {
  it("returns the chart-declared namespace when set", () => {
    const d: Deployable = {
      ...baseDeployable,
      name: "identity",
      namespace: "auth",
    };
    expect(resolveDeployableNamespace(d)).toBe("auth");
  });

  it("falls back to apps when the chart annotation is unset", () => {
    const d: Deployable = { ...baseDeployable, name: "some-app" };
    expect(resolveDeployableNamespace(d)).toBe(IX_APPS_NAMESPACE);
  });

  it("treats an empty-string namespace annotation as unset", () => {
    const d: Deployable = {
      ...baseDeployable,
      name: "scenario-service",
      namespace: "",
    };
    expect(resolveDeployableNamespace(d)).toBe(IX_APPS_NAMESPACE);
  });

  it("handles a Deployable cached without the namespace field (back-compat)", () => {
    const d = { ...baseDeployable, name: "identity" };
    delete (d as Partial<Deployable>).namespace;
    expect(resolveDeployableNamespace(d as Deployable)).toBe(IX_APPS_NAMESPACE);
  });
});
