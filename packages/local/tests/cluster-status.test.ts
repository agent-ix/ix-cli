/**
 * TC-039–TC-043: runClusterStatus()
 * FR-007 (read-only node + unhealthy pod summary)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("execa");
vi.mock("@agent-ix/ix-ui-cli", () => {
  const success = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    startListing: vi.fn(() => ({
      group: vi.fn(),
      item: vi.fn(),
      note: vi.fn(),
      raw: vi.fn(),
      commit: vi.fn(),
      pause: vi.fn(),
      success,
      warn,
      error,
    })),
    __success: success,
    __warn: warn,
    __error: error,
  };
});
vi.mock("picocolors", () => ({
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
  },
}));

import { execa } from "execa";
import * as ui from "@agent-ix/ix-ui-cli";
import { runClusterStatus } from "../src/commands/cluster-status.js";

const mockExeca = vi.mocked(execa);
type Bag = typeof ui & {
  __success: ReturnType<typeof vi.fn>;
  __warn: ReturnType<typeof vi.fn>;
  __error: ReturnType<typeof vi.fn>;
};
const mockSuccess = (ui as unknown as Bag).__success;
const mockWarn = (ui as unknown as Bag).__warn;
const mockError = (ui as unknown as Bag).__error;

const makeNode = (
  name: string,
  ready: boolean,
  isControlPlane = false,
  creationTimestamp = "2024-01-01T00:00:00Z",
) => ({
  metadata: { name, creationTimestamp },
  status: {
    conditions: [{ type: "Ready", status: ready ? "True" : "False" }],
  },
  ...(isControlPlane ? { spec: { taints: [{ effect: "NoSchedule" }] } } : {}),
});

const makePod = (
  name: string,
  namespace: string,
  phase: string,
  restarts = 0,
) => ({
  metadata: { name, namespace },
  status: {
    phase,
    containerStatuses: [{ restartCount: restarts, state: {} }],
  },
});

function stubKubectl(nodes: object[], pods: object[]) {
  mockExeca
    .mockResolvedValueOnce({
      stdout: JSON.stringify({ items: nodes }),
    } as never)
    .mockResolvedValueOnce({
      stdout: JSON.stringify({ items: pods }),
    } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runClusterStatus", () => {
  it("TC-039: node table rendered with NAME, ROLE, STATUS, AGE columns", async () => {
    stubKubectl(
      [makeNode("ix-control-plane", true, true)],
      [makePod("coredns-abc", "kube-system", "Running")],
    );

    await runClusterStatus();

    const written = (
      process.stdout.write as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("");
    expect(written).toContain("NAME");
    expect(written).toContain("ROLE");
    expect(written).toContain("STATUS");
    expect(written).toContain("AGE");
    expect(written).toContain("ix-control-plane");
    expect(written).toContain("control-plane");
  });

  it("TC-040: all pods healthy — success outro with 'All pods healthy.' and no pod table", async () => {
    stubKubectl(
      [makeNode("ix-control-plane", true, true)],
      [
        makePod("pod-a", "default", "Running"),
        makePod("pod-b", "kube-system", "Succeeded"),
      ],
    );

    await runClusterStatus();

    expect(mockSuccess).toHaveBeenCalledWith("All pods healthy.");
    const written = (
      process.stdout.write as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("");
    expect(written).not.toContain("NAMESPACE");
  });

  it("TC-041: unhealthy pod present — pod table rendered with NAMESPACE, NAME, PHASE, RESTARTS", async () => {
    stubKubectl(
      [makeNode("ix-control-plane", true, true)],
      [
        makePod("good-pod", "default", "Running"),
        makePod("bad-pod", "kube-system", "CrashLoopBackOff", 5),
      ],
    );

    await runClusterStatus();

    expect(mockSuccess).not.toHaveBeenCalledWith("All pods healthy.");
    expect(mockWarn).toHaveBeenCalled();
    const written = (
      process.stdout.write as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("");
    expect(written).toContain("NAMESPACE");
    expect(written).toContain("NAME");
    expect(written).toContain("PHASE");
    expect(written).toContain("RESTARTS");
    expect(written).toContain("bad-pod");
    expect(written).toContain("kube-system");
  });

  it("TC-042: kubectl get nodes fails — error outro called and descriptive error thrown", async () => {
    mockExeca.mockRejectedValueOnce(new Error("connection refused") as never);

    await expect(runClusterStatus()).rejects.toThrow(
      "kubectl get nodes failed",
    );
    expect(mockError).toHaveBeenCalled();
  });

  it("TC-043: picocolors mock strips color codes from node status and pod phase", async () => {
    stubKubectl(
      [makeNode("ix-control-plane", false, true)],
      [makePod("bad-pod", "default", "CrashLoopBackOff")],
    );

    await runClusterStatus();

    const written = (
      process.stdout.write as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("");
    expect(written).toContain("NotReady");
    expect(written).toContain("CrashLoopBackOff");
    expect(written).not.toMatch(/\x1b\[[\d;]*mNotReady/);
    expect(written).not.toMatch(/\x1b\[[\d;]*mCrashLoopBackOff/);
  });
});
