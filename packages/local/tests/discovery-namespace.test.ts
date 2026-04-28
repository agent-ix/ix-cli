import { describe, it, expect } from "vitest";

import {
  IX_APPS_NAMESPACE,
  IX_AUTH_NAMESPACE,
  IX_NAMESPACE_BY_CHART,
  IX_PLATFORM_NAMESPACE,
  IX_SYSTEM_NAMESPACE,
} from "../src/config.js";
import {
  resolveDeployableNamespace,
  resolveNamespaceByName,
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
    // Hard-coded values are part of the public contract; ix-cli/spec/functional/
    // local/auth.md and auth/NFR-003 reference these literals directly.
    expect(IX_SYSTEM_NAMESPACE).toBe("system");
    expect(IX_AUTH_NAMESPACE).toBe("auth");
    expect(IX_PLATFORM_NAMESPACE).toBe("platform");
    expect(IX_APPS_NAMESPACE).toBe("apps");
  });

  it("name-fallback table places auth services in the auth namespace", () => {
    expect(IX_NAMESPACE_BY_CHART.identity).toBe(IX_AUTH_NAMESPACE);
    expect(IX_NAMESPACE_BY_CHART["auth-service"]).toBe(IX_AUTH_NAMESPACE);
    expect(IX_NAMESPACE_BY_CHART["permission-service"]).toBe(IX_AUTH_NAMESPACE);
  });

  it("name-fallback table places shared infra in the platform namespace", () => {
    for (const chart of [
      "npm-proxy",
      "pypi-proxy",
      "postgres",
      "redis",
      "rabbitmq",
      "vault",
      "k8s-gateway",
    ]) {
      expect(IX_NAMESPACE_BY_CHART[chart]).toBe(IX_PLATFORM_NAMESPACE);
    }
  });
});

describe("resolveDeployableNamespace", () => {
  it("returns the chart-declared namespace when set (annotation precedence)", () => {
    const d: Deployable = {
      ...baseDeployable,
      name: "identity",
      namespace: "custom-ns",
    };
    expect(resolveDeployableNamespace(d)).toBe("custom-ns");
  });

  it("falls back to IX_NAMESPACE_BY_CHART when annotation absent", () => {
    const d: Deployable = { ...baseDeployable, name: "identity" };
    expect(resolveDeployableNamespace(d)).toBe(IX_AUTH_NAMESPACE);
  });

  it("falls back to apps for charts not in the table", () => {
    const d: Deployable = { ...baseDeployable, name: "catalog-service" };
    expect(resolveDeployableNamespace(d)).toBe(IX_APPS_NAMESPACE);
  });

  it("treats an empty-string namespace annotation as unset", () => {
    // Defensive: a chart that mistakenly publishes namespace="" should not
    // collapse to literally namespace `""`. Falls back like null/undefined.
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
    expect(resolveDeployableNamespace(d as Deployable)).toBe(IX_AUTH_NAMESPACE);
  });
});

describe("resolveNamespaceByName", () => {
  it("returns auth for identity / auth-service / permission-service", () => {
    expect(resolveNamespaceByName("identity")).toBe(IX_AUTH_NAMESPACE);
    expect(resolveNamespaceByName("auth-service")).toBe(IX_AUTH_NAMESPACE);
    expect(resolveNamespaceByName("permission-service")).toBe(
      IX_AUTH_NAMESPACE,
    );
  });

  it("returns platform for shared infrastructure charts", () => {
    expect(resolveNamespaceByName("postgres")).toBe(IX_PLATFORM_NAMESPACE);
    expect(resolveNamespaceByName("redis")).toBe(IX_PLATFORM_NAMESPACE);
  });

  it("returns apps for unknown charts", () => {
    expect(resolveNamespaceByName("some-future-app")).toBe(IX_APPS_NAMESPACE);
  });
});
