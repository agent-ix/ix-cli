import { describe, expect, it, vi } from "vitest";
import type { ServiceRow } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../src/config.js";
import {
  runSourceModePipeline,
  type SourceModePlan,
  type SourcePhase,
} from "../src/up-source-controller.js";

vi.mock("../src/namespaces.js", () => ({
  ensureNamespace: vi.fn(),
}));
vi.mock("../src/local-secrets.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-secrets.js")
  >("../src/local-secrets.js");
  return {
    ...actual,
    applySecretContract: vi.fn(async () => {
      throw new Error("secret apply failed");
    }),
  };
});

const config: IxConfig = {
  org: "agent-ix",
  hosts: ["dev.ix"],
  internalBaseDomain: "dev.ix",
  externalBaseDomain: null,
  enableExternalHost: false,
  publicBaseUrl: null,
  imageTag: "latest",
  imageRegistry: "ghcr.io/agent-ix",
  helmChartRegistry: "ghcr.io",
  kindClusterName: "ix",
  certManagerVersion: "v1.0.0",
  certManagerTimeoutSeconds: 1,
  certWaitTimeoutSeconds: 1,
  ingressNginxVersion: "v1.0.0",
  ingressNginxTimeoutSeconds: 1,
  rolloutTimeoutSeconds: 30,
};

describe("runSourceModePipeline", () => {
  it("TC-290: marks source secret application failures on the secrets phase", async () => {
    const plan: SourceModePlan = {
      installs: [
        {
          name: "identity",
          chartPath: "/tmp/identity/helm",
          valuesFiles: ["/tmp/identity/helm/values.yaml"],
          repoDir: "/tmp/identity",
          secretContractDir: "/tmp/identity/helm",
          dependencyUpdate: false,
          tags: [],
          namespace: "auth",
        },
      ],
      secretContracts: [
        {
          repoDir: "/tmp/identity/helm",
          secrets: [{ name: "identity-secret", keys: [] }],
        },
      ],
      requiresRegistryAuth: false,
      imageTag: "latest",
      tmpDir: "/tmp/ix-local-source-test",
      dispose: vi.fn(),
    };
    const snapshots: ServiceRow<SourcePhase>[][] = [];

    await expect(
      runSourceModePipeline(plan, config, {}, (rows) => snapshots.push(rows)),
    ).rejects.toThrow("secret apply failed");

    const row = snapshots.at(-1)?.find((r) => r.name === "identity");
    expect(row?.phases.secrets).toBe("failed");
    expect(row?.phases.build).toBe("pending");
    expect(row?.error).toBe("secret apply failed");
  });
});
