/**
 * waitForRollout — discovers Deployments and StatefulSets via label selector.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa");

import { execa } from "execa";
import {
  waitForRollout,
  detectHelmHookFailure,
  detectHelmHookStatus,
  detectHelmHookStatuses,
  getRolloutReadyStatus,
  cleanupFailedHelmHookJobs,
} from "../src/rollout.js";

const mockExeca = vi.mocked(execa);

const fakeTask = { output: "" } as unknown as Parameters<
  typeof waitForRollout
>[3];

function workloadJson(
  ready: number,
  total: number,
  opts: {
    available?: number;
    currentRevision?: string;
    generation?: number;
    observedGeneration?: number;
    updated?: number;
    updateRevision?: string;
  } = {},
): string {
  return JSON.stringify({
    metadata: { generation: opts.generation ?? 1 },
    spec: { replicas: total },
    status: {
      availableReplicas: opts.available ?? ready,
      currentRevision: opts.currentRevision,
      observedGeneration: opts.observedGeneration ?? opts.generation ?? 1,
      readyReplicas: ready,
      updatedReplicas: opts.updated ?? ready,
      updateRevision: opts.updateRevision,
    },
  });
}

describe("waitForRollout", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it("queries deployments AND statefulsets when given a selector", async () => {
    // get workloads
    mockExeca.mockResolvedValueOnce({
      stdout: "statefulset.apps/vault\n",
    } as never);
    // initial getDeploymentStatus jsonpath
    mockExeca.mockResolvedValueOnce({ stdout: workloadJson(1, 1) } as never);
    // rollout status (subprocess — we resolve with empty all stream)
    const fakeProc = Promise.resolve({} as never) as unknown as ReturnType<
      typeof execa
    > & { all: { on: () => void } };
    (fakeProc as unknown as { all: { on: (...a: unknown[]) => void } }).all = {
      on: () => {},
    };
    mockExeca.mockReturnValueOnce(fakeProc);
    // final getDeploymentStatus
    mockExeca.mockResolvedValueOnce({ stdout: workloadJson(1, 1) } as never);

    await waitForRollout(
      "vault",
      "default",
      30,
      fakeTask,
      "app.kubernetes.io/part-of=vault",
    );

    const firstCall = mockExeca.mock.calls[0];
    expect(firstCall[0]).toBe("kubectl");
    const argv = firstCall[1] as string[];
    expect(argv).toContain("get");
    expect(argv).toContain("deployments,statefulsets");
    expect(argv).toContain("-l");
    expect(argv).toContain("app.kubernetes.io/part-of=vault");
  });

  it("throws a workload-aware error when selector matches nothing", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "" } as never);
    await expect(
      waitForRollout("ghost", "default", 30, fakeTask, "app=ghost"),
    ).rejects.toThrow(
      /No workloads \(deployment\/statefulset\) found for selector 'app=ghost'/,
    );
  });

  // TC-109: FR-031-AC-13 — enriched "0/N·label" status when readyReplicas=0
  it("enriches onStatus with ·label when readyReplicas is 0", async () => {
    // 1. get workloads → one deployment
    mockExeca.mockResolvedValueOnce({
      stdout: "deployment.apps/auth-service\n",
    } as never);
    // 2. initial getDeploymentStatus jsonpath → ready=0, total=1
    mockExeca.mockResolvedValueOnce({ stdout: workloadJson(0, 1) } as never);
    // 3. getPodReadyLabel kubectl get pods → ContainerCreating
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            status: {
              containerStatuses: [
                { state: { waiting: { reason: "ContainerCreating" } } },
              ],
            },
          },
        ],
      }),
    } as never);
    // 4. rollout status subprocess — resolves immediately, no stream output
    const fakeProc = Promise.resolve({} as never) as unknown as ReturnType<
      typeof execa
    > & { all: { on: () => void } };
    (fakeProc as unknown as { all: { on: (...a: unknown[]) => void } }).all = {
      on: () => {},
    };
    mockExeca.mockReturnValueOnce(fakeProc);
    // 5. detectTerminalFailure kubectl get pods → no failures
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ items: [] }),
    } as never);
    // 6. final getDeploymentStatus jsonpath → ready=1, total=1
    mockExeca.mockResolvedValueOnce({ stdout: workloadJson(1, 1) } as never);

    const statuses: string[] = [];
    await waitForRollout(
      "auth-service",
      "default",
      30,
      fakeTask,
      "app=auth-service",
      (s) => statuses.push(s),
    );

    // Initial status when ready=0 must carry the ·start label
    expect(statuses[0]).toBe("0/1·start");
    // Final status must be the plain ready count with no label
    expect(statuses[statuses.length - 1]).toMatch(/^1\/1/);
  });
});

describe("getRolloutReadyStatus", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it("returns live workload ready status without waiting for rollout completion", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "deployment.apps/catalog-service\n",
    } as never);
    mockExeca.mockResolvedValueOnce({ stdout: workloadJson(1, 2) } as never);

    await expect(
      getRolloutReadyStatus(
        "catalog-service",
        "apps",
        "app.kubernetes.io/instance=catalog-service",
      ),
    ).resolves.toBe("1/2");
  });

  it("labels full ready status as settling when the controller has not reconciled", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "deployment.apps/catalog-service\n",
    } as never);
    mockExeca.mockResolvedValueOnce({
      stdout: workloadJson(1, 1, {
        available: 0,
        generation: 2,
        observedGeneration: 1,
      }),
    } as never);

    await expect(
      getRolloutReadyStatus(
        "catalog-service",
        "apps",
        "app.kubernetes.io/instance=catalog-service",
      ),
    ).resolves.toBe("1/1·settle");
  });

  it("labels full ready status as settling during a rolling update with old ready pods", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "deployment.apps/identity\n",
    } as never);
    mockExeca.mockResolvedValueOnce({
      stdout: workloadJson(1, 1, { available: 1, updated: 0 }),
    } as never);

    await expect(
      getRolloutReadyStatus(
        "identity",
        "auth",
        "app.kubernetes.io/instance=identity",
      ),
    ).resolves.toBe("1/1·settle");
  });

  it("labels full ready StatefulSet status as settling until revisions match", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "statefulset.apps/catalog-db\n",
    } as never);
    mockExeca.mockResolvedValueOnce({
      stdout: workloadJson(1, 1, {
        currentRevision: "catalog-db-abc",
        updated: 1,
        updateRevision: "catalog-db-def",
      }),
    } as never);

    await expect(
      getRolloutReadyStatus(
        "catalog-db",
        "apps",
        "app.kubernetes.io/instance=catalog-db",
      ),
    ).resolves.toBe("1/1·settle");
  });

  it("returns null when workloads are not created yet", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "" } as never);

    await expect(
      getRolloutReadyStatus("missing", "apps", "app=missing"),
    ).resolves.toBeNull();
  });
});

describe("detectHelmHookFailure", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it("returns an early terminal pod failure for a Helm hook job", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              name: "auth-permission-service-pgboot",
              annotations: { "helm.sh/hook": "pre-install" },
            },
            status: {},
          },
        ],
      }),
    } as never);
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            status: {
              containerStatuses: [
                {
                  state: {
                    waiting: {
                      reason: "CreateContainerConfigError",
                      message: 'secret "permission-service-secrets" not found',
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    } as never);

    await expect(detectHelmHookFailure("auth", "auth")).resolves.toEqual({
      jobName: "auth-permission-service-pgboot",
      message:
        'CreateContainerConfigError (secret "permission-service-secrets" not found)',
    });
  });

  it("falls back to the job failed condition message when pod state is gone", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              name: "auth-permission-service-pgboot",
              annotations: { "helm.sh/hook": "pre-install" },
            },
            status: {
              conditions: [
                {
                  type: "Failed",
                  status: "True",
                  message: "Job was active longer than specified deadline",
                },
              ],
            },
          },
        ],
      }),
    } as never);
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ items: [] }),
    } as never);

    await expect(detectHelmHookFailure("auth", "auth")).resolves.toEqual({
      jobName: "auth-permission-service-pgboot",
      message: "Job was active longer than specified deadline",
    });
  });
});

describe("detectHelmHookStatus", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it("returns running hook status with the latest pod log line", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              name: "cloud-manager-app-catalog-service-pgboot",
              annotations: { "helm.sh/hook": "pre-install" },
            },
            status: { active: 1 },
          },
        ],
      }),
    } as never);
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              name: "cloud-manager-app-catalog-service-pgboot-smgkx",
            },
            status: {
              containerStatuses: [
                {
                  state: {
                    running: {},
                  },
                },
              ],
            },
          },
        ],
      }),
    } as never);
    mockExeca.mockResolvedValueOnce({
      stdout:
        "waiting for postgres at postgres.platform.svc.cluster.local:5432 ...\n",
    } as never);

    await expect(
      detectHelmHookStatus("apps", "cloud-manager-app"),
    ).resolves.toEqual({
      jobName: "cloud-manager-app-catalog-service-pgboot",
      phase: "running",
      message:
        "waiting for postgres at postgres.platform.svc.cluster.local:5432 ...",
    });
  });

  it("returns status for every observed Helm hook job", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              name: "cloud-manager-app-catalog-service-pgboot",
              annotations: { "helm.sh/hook": "pre-install" },
            },
            status: { active: 1 },
          },
          {
            metadata: {
              name: "cloud-manager-app-settings-service-pgboot",
              annotations: { "helm.sh/hook": "pre-install" },
            },
            status: { active: 1 },
          },
        ],
      }),
    } as never);
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            metadata: { name: "catalog-pod" },
            status: { containerStatuses: [{ state: { running: {} } }] },
          },
        ],
      }),
    } as never);
    mockExeca.mockResolvedValueOnce({ stdout: "catalog waiting\n" } as never);
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            metadata: { name: "settings-pod" },
            status: { containerStatuses: [{ state: { running: {} } }] },
          },
        ],
      }),
    } as never);
    mockExeca.mockResolvedValueOnce({ stdout: "settings waiting\n" } as never);

    await expect(
      detectHelmHookStatuses("apps", "cloud-manager-app"),
    ).resolves.toEqual([
      {
        jobName: "cloud-manager-app-catalog-service-pgboot",
        phase: "running",
        message: "catalog waiting",
      },
      {
        jobName: "cloud-manager-app-settings-service-pgboot",
        phase: "running",
        message: "settings waiting",
      },
    ]);
  });
});

describe("cleanupFailedHelmHookJobs", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it("deletes only failed Helm hook jobs for the release", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              name: "auth-permission-service-pgboot",
              annotations: { "helm.sh/hook": "pre-install,pre-upgrade" },
            },
            status: {
              conditions: [{ type: "Failed", status: "True" }],
            },
          },
          {
            metadata: {
              name: "auth-identity-pgboot",
              annotations: { "helm.sh/hook": "pre-install,pre-upgrade" },
            },
            status: {
              conditions: [{ type: "Complete", status: "True" }],
            },
          },
          {
            metadata: {
              name: "ordinary-failed-job",
              annotations: {},
            },
            status: {
              conditions: [{ type: "Failed", status: "True" }],
            },
          },
        ],
      }),
    } as never);
    mockExeca.mockResolvedValueOnce({ stdout: "" } as never);

    await expect(cleanupFailedHelmHookJobs("auth", "auth")).resolves.toEqual([
      "auth-permission-service-pgboot",
    ]);

    expect(mockExeca).toHaveBeenCalledTimes(2);
    expect(mockExeca).toHaveBeenNthCalledWith(2, "kubectl", [
      "delete",
      "job",
      "auth-permission-service-pgboot",
      "-n",
      "auth",
      "--ignore-not-found=true",
    ]);
  });
});
