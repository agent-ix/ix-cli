import { beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { runSingleServicePipeline } from "../src/up-image-controller.js";
import type { IxConfig } from "../src/config.js";
import type { Deployable } from "../src/discovery.js";
import type { ServiceRow } from "@agent-ix/ix-ui-cli";
import type { Phase } from "../src/phases.js";

vi.mock("execa");
vi.mock("../src/local-secrets.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-secrets.js")
  >("../src/local-secrets.js");
  return {
    ...actual,
    applySecretContract: vi.fn(),
    loadSecretContractFromTgz: vi.fn(),
  };
});
vi.mock("../src/rollout.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/rollout.js")>(
      "../src/rollout.js",
    );
  return {
    ...actual,
    waitForRollout: vi.fn(),
  };
});

const mockExeca = vi.mocked(execa);

const config: IxConfig = {
  org: "agent-ix",
  helmChartRegistry: "ghcr.io",
  imageTag: "latest",
  imageRegistry: "ghcr.io/agent-ix",
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
  hosts: ["dev.ix"],
};

const deployable: Deployable = {
  name: "identity",
  chartRepository: "agent-ix/identity",
  version: "0.1.0",
  role: "service",
  title: null,
  category: null,
  tags: [],
  source: null,
  entry: null,
};

function latestRow(snapshots: ServiceRow<Phase>[][]): ServiceRow<Phase> {
  const snapshot = snapshots.at(-1);
  if (!snapshot) throw new Error("missing snapshot");
  const row = snapshot.find((r) => r.name === "identity");
  if (!row) throw new Error("missing identity row");
  return row;
}

describe("runSingleServicePipeline", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it("TC-289: marks helm upgrade failures on the install phase", async () => {
    mockExeca.mockImplementation(async (file, args) => {
      if (file === "helm" && args?.[0] === "pull") {
        return { stdout: "", stderr: "", all: "" } as never;
      }
      if (file === "helm" && args?.[0] === "upgrade") {
        throw new Error("helm failed");
      }
      return { stdout: "", stderr: "", all: "" } as never;
    });
    const snapshots: ServiceRow<Phase>[][] = [];

    await expect(
      runSingleServicePipeline(
        {
          install: {
            name: "identity",
            chartRef: "oci://ghcr.io/agent-ix/identity",
            chartVersion: "0.1.0",
            namespace: "auth",
          },
          deployable,
          config,
          tagOverride: null,
          opts: {},
        },
        (rows) => snapshots.push(rows),
      ),
    ).rejects.toThrow("helm failed");

    const row = latestRow(snapshots);
    expect(row.phases.install).toBe("failed");
    expect(row.phases.ready).toBe("pending");
    expect(row.error).toBe("helm failed");
  });
});
