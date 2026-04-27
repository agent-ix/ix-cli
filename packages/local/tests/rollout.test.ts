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
});
