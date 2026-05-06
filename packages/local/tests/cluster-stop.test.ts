/**
 * TC-310, TC-312, TC-314, TC-316: runClusterStop()
 * FR-036 — pause kind cluster via docker stop on node containers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("execa");
vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

import { execa } from "execa";
import * as ui from "@agent-ix/ix-ui-cli";
import { runClusterStop } from "../src/commands/cluster-stop.js";
import type { IxConfig } from "../src/config.js";

const config: IxConfig = {
  kindClusterName: "ix",
  internalBaseDomain: "dev.ix",
  externalBaseDomain: null,
  enableExternalHost: false,
  imageTag: "latest",
  imageRegistry: "ghcr.io/agent-ix",
  helmChartRegistry: "ghcr.io",
  org: "agent-ix",
  certManagerVersion: "v1.14.5",
  certManagerTimeoutSeconds: 180,
  certWaitTimeoutSeconds: 120,
  rolloutTimeoutSeconds: 300,
};

const mockExeca = vi.mocked(execa);
const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;

beforeEach(() => {
  vi.clearAllMocks();
  resetListings();
});

describe("runClusterStop", () => {
  it("TC-310: docker stop run on every node from kind get nodes", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "ix-control-plane\nix-worker\n",
    } as never);
    mockExeca.mockResolvedValueOnce({} as never);
    mockExeca.mockResolvedValueOnce({} as never);

    await runClusterStop(config);

    const stopCalls = mockExeca.mock.calls.filter(
      (args) => args[0] === "docker" && (args[1] as string[])[0] === "stop",
    );
    expect(stopCalls).toHaveLength(2);
    expect(stopCalls.map((c) => (c[1] as string[])[1])).toEqual([
      "ix-control-plane",
      "ix-worker",
    ]);
  });

  it("TC-312: idempotent — already-stopped node still reports 'stopped' state", async () => {
    // Real `docker stop <name>` on an already-stopped container exits 0 and
    // echoes the name. Mocking it as resolving (not rejecting) reflects that.
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);

    await runClusterStop(config);

    const passed = calls.find((c) => c.status === "passed");
    expect(passed).toBeDefined();
    expect(passed!.items).toHaveLength(1);
    expect(passed!.items[0].name).toBe("ix-control-plane");
    expect(passed!.items[0].description).toBe("stopped");
  });

  it("TC-326: real docker error surfaces in the row description without aborting the run", async () => {
    // Distinct from the idempotent case: a *real* docker failure (e.g. perms)
    // should still produce a Listing — just with the error embedded.
    mockExeca.mockResolvedValueOnce({
      stdout: "ix-control-plane\nix-worker\n",
    } as never);
    mockExeca.mockRejectedValueOnce(new Error("permission denied") as never);
    mockExeca.mockResolvedValueOnce({ stdout: "ix-worker\n" } as never);

    await runClusterStop(config);

    const passed = calls.find((c) => c.status === "passed");
    expect(passed).toBeDefined();
    expect(passed!.items).toHaveLength(2);
    expect(String(passed!.items[0].description)).toContain("permission denied");
    expect(passed!.items[1].description).toBe("stopped");
  });

  it("TC-327: kind-binary failure (e.g. missing kind) renders failed listing distinct from absent-cluster", async () => {
    mockExeca.mockRejectedValueOnce(
      new Error("kind: command not found") as never,
    );

    await expect(runClusterStop(config)).rejects.toThrow(/command not found/);

    const failed = calls.find((c) => c.status === "failed");
    expect(failed).toBeDefined();
    expect(failed!.tail).toEqual(expect.stringContaining("kind get nodes"));
    expect(failed!.tail).toEqual(expect.stringContaining("docker daemon"));
  });

  it("TC-314: absent kind cluster — failed listing, throws", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "" } as never);

    await expect(runClusterStop(config)).rejects.toThrow(/does not exist/);

    const failed = calls.find((c) => c.status === "failed");
    expect(failed).toBeDefined();
    expect(failed!.tail).toEqual(expect.stringContaining("ix"));
  });

  it("TC-316: Listing rendered with (node, state) rows", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockResolvedValueOnce({} as never);

    await runClusterStop(config);

    const passed = calls.find((c) => c.status === "passed");
    expect(passed).toBeDefined();
    expect(passed!.items[0].name).toBe("ix-control-plane");
    expect(passed!.items[0].description).toBe("stopped");
  });
});
