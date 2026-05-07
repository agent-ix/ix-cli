/**
 * TC-421: command-level tunnel expose/unexpose helm upgrade contracts.
 *   FR-038 (Cloudflare tunnel exposure).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { exposeApp, unexposeApp } from "../../src/tunnel/expose.js";
import type { IxConfig } from "../../src/config.js";
import type { Deployable } from "../../src/discovery.js";

vi.mock("execa");

const mockExeca = vi.mocked(execa);

const config: IxConfig = {
  org: "agent-ix",
  helmChartRegistry: "ghcr.io",
  imageTag: "latest",
  imageRegistry: "ghcr.io/agent-ix",
  hosts: ["dev.ix"],
  internalBaseDomain: "dev.ix",
  externalBaseDomain: null,
  enableExternalHost: false,
  publicBaseUrl: null,
  kindClusterName: "ix",
  certManagerVersion: "v1.0.0",
  ingressNginxVersion: "v1.0.0",
  certManagerTimeoutSeconds: 1,
  ingressNginxTimeoutSeconds: 1,
  certWaitTimeoutSeconds: 1,
  rolloutTimeoutSeconds: 30,
};

const deployable: Deployable = {
  name: "cloud-manager",
  chartRepository: "agent-ix/cloud-manager",
  version: "1.2.3",
  role: "service",
  title: null,
  category: null,
  tags: [],
  source: null,
  entry: null,
  namespace: "apps",
};

describe("tunnel expose helm upgrade", () => {
  beforeEach(() => {
    mockExeca.mockReset();
    mockExeca.mockImplementation(async (_file, args) => {
      const argv = args as string[];
      if (argv[0] === "get" && argv[1] === "values") {
        return { stdout: "{}", stderr: "", all: "" } as never;
      }
      if (argv[0] === "get" && argv[1] === "manifest") {
        return {
          stdout:
            "apiVersion: networking.k8s.io/v1\nkind: Ingress\nspec:\n  rules:\n    - host: cloud-manager.agent-ix.dev\n",
          stderr: "",
          all: "",
        } as never;
      }
      return { stdout: "", stderr: "", all: "" } as never;
    });
  });

  it("TC-421: expose passes chart ref and chart version to helm upgrade", async () => {
    await exposeApp("cloud-manager", [deployable], config, "agent-ix.dev");

    const upgrade = mockExeca.mock.calls.find(
      ([file, args]) => file === "helm" && (args as string[])[0] === "upgrade",
    );
    expect(upgrade).toBeDefined();
    expect(upgrade![1]).toEqual(
      expect.arrayContaining([
        "cloud-manager",
        "oci://ghcr.io/agent-ix/cloud-manager/cloud-manager",
        "--version",
        "1.2.3",
        "--reuse-values",
      ]),
    );
  });

  it("TC-421b: unexpose passes chart ref and chart version to helm upgrade", async () => {
    await unexposeApp("cloud-manager", [deployable], config, "agent-ix.dev");

    const upgrade = mockExeca.mock.calls.find(
      ([file, args]) => file === "helm" && (args as string[])[0] === "upgrade",
    );
    expect(upgrade).toBeDefined();
    expect(upgrade![1]).toEqual(
      expect.arrayContaining([
        "cloud-manager",
        "oci://ghcr.io/agent-ix/cloud-manager/cloud-manager",
        "--version",
        "1.2.3",
        "--reuse-values",
      ]),
    );
  });

  it("TC-421c: missing release surfaces the actionable ix up hint", async () => {
    mockExeca.mockRejectedValueOnce(new Error("Error: release: not found"));

    await expect(
      exposeApp("cloud-manager", [deployable], config, "agent-ix.dev"),
    ).rejects.toThrow(
      "No helm release named 'cloud-manager' in namespace 'apps'. Run `ix up cloud-manager` first.",
    );
  });
});
