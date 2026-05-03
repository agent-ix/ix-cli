/**
 * waitForRollout — discovers Deployments and StatefulSets via label selector.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa");

import { execa } from "execa";
import { waitForRollout } from "../src/rollout.js";

const mockExeca = vi.mocked(execa);

const fakeTask = { output: "" } as unknown as Parameters<
  typeof waitForRollout
>[3];

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
    mockExeca.mockResolvedValueOnce({ stdout: "1/1" } as never);
    // rollout status (subprocess — we resolve with empty all stream)
    const fakeProc = Promise.resolve({} as never) as unknown as ReturnType<
      typeof execa
    > & { all: { on: () => void } };
    (fakeProc as unknown as { all: { on: (...a: unknown[]) => void } }).all = {
      on: () => {},
    };
    mockExeca.mockReturnValueOnce(fakeProc);
    // final getDeploymentStatus
    mockExeca.mockResolvedValueOnce({ stdout: "1/1" } as never);

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
    mockExeca.mockResolvedValueOnce({ stdout: "0/1/1/1/0" } as never);
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
    mockExeca.mockResolvedValueOnce({ stdout: "1/1/1/1/1" } as never);

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
