/**
 * TC-311, TC-313, TC-315, TC-318: runClusterStart()
 * FR-036 — resume kind cluster and wait for API server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("execa");
vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

import { execa } from "execa";
import * as ui from "@agent-ix/ix-ui-cli";
import { runClusterStart } from "../src/commands/cluster-start.js";
import type { IxConfig } from "../src/config.js";

const config: IxConfig = {
  kindClusterName: "ix",
  hosts: ["dev.ix"],
  internalBaseDomain: "dev.ix",
  externalBaseDomain: null,
  enableExternalHost: false,
  publicBaseUrl: null,
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

describe("runClusterStart", () => {
  it("TC-311: docker start every node and wait for API server", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockResolvedValueOnce({} as never);
    const waitForApi = vi.fn(async () => true);

    await runClusterStart(config, {}, { waitForApi });

    const startCalls = mockExeca.mock.calls.filter(
      (args) => args[0] === "docker" && (args[1] as string[])[0] === "start",
    );
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0][1]).toEqual(["start", "ix-control-plane"]);
    expect(waitForApi).toHaveBeenCalledTimes(1);
  });

  it("TC-313: idempotent — already-running container still reports 'running' state", async () => {
    // Real `docker start <name>` on a running container exits 0 with the name
    // echoed. Mocking it as resolving (not rejecting) reflects that.
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    const waitForApi = vi.fn(async () => true);

    await runClusterStart(config, {}, { waitForApi });

    const passed = calls.find((c) => c.status === "passed");
    expect(passed).toBeDefined();
    expect(passed!.items[0].name).toBe("ix-control-plane");
    expect(passed!.items[0].description).toBe("running");
  });

  it("TC-328: real docker error surfaces in row description without aborting", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockRejectedValueOnce(new Error("permission denied") as never);
    const waitForApi = vi.fn(async () => true);

    await runClusterStart(config, {}, { waitForApi });

    const passed = calls.find((c) => c.status === "passed");
    expect(passed).toBeDefined();
    expect(String(passed!.items[0].description)).toContain("permission denied");
  });

  it("TC-329: kind-binary failure renders failed listing distinct from absent-cluster", async () => {
    mockExeca.mockRejectedValueOnce(
      new Error("kind: command not found") as never,
    );

    await expect(runClusterStart(config)).rejects.toThrow(/command not found/);

    const failed = calls.find((c) => c.status === "failed");
    expect(failed).toBeDefined();
    expect(failed!.tail).toEqual(expect.stringContaining("kind get nodes"));
  });

  it("TC-315: absent kind cluster — failed listing, throws", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "" } as never);

    await expect(runClusterStart(config)).rejects.toThrow(/does not exist/);

    const failed = calls.find((c) => c.status === "failed");
    expect(failed).toBeDefined();
  });

  it("TC-318: API timeout renders warn (not failed) and returns 0", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockResolvedValueOnce({} as never);
    const waitForApi = vi.fn(async () => false);

    await runClusterStart(config, {}, { waitForApi });

    const last = calls[calls.length - 1];
    expect(last.status).toBe("passed");
    expect(last.tailVariant).toBe("warn");
    expect(last.tail).toEqual(expect.stringContaining("did not respond"));
  });

  it("TC-417: tunnel autoStart=false skips tunnel install entirely", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockResolvedValueOnce({} as never);
    const waitForApi = vi.fn(async () => true);
    const runTunnelUp = vi.fn(async () => ({
      installed: true,
      skippedReason: null,
    }));

    await runClusterStart(
      config,
      {},
      {
        waitForApi,
        loadTunnelConfig: () => ({
          autoStart: false,
          baseDomain: "agent-ix.dev",
          tunnelId: null,
        }),
        runTunnelUp,
      },
    );

    expect(runTunnelUp).not.toHaveBeenCalled();
    expect(
      calls.some((c) => c.header === "ix local cluster start · tunnel"),
    ).toBe(false);
  });

  it("TC-419: tunnel autoStart=true skip renders warn-tail listing and returns success", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockResolvedValueOnce({} as never);
    const waitForApi = vi.fn(async () => true);

    await runClusterStart(
      config,
      {},
      {
        waitForApi,
        loadTunnelConfig: () => ({
          autoStart: true,
          baseDomain: "agent-ix.dev",
          tunnelId: null,
        }),
        runTunnelUp: vi.fn(async () => ({
          installed: false,
          skippedReason: "no GHCR token for cloudflared chart pull",
        })),
      },
    );

    const tunnel = calls.find(
      (c) => c.header === "ix local cluster start · tunnel",
    );
    expect(tunnel).toBeDefined();
    expect(tunnel!.status).toBe("passed");
    expect(tunnel!.tailVariant).toBe("warn");
    expect(tunnel!.tail).toEqual(expect.stringContaining("Skipped"));
  });

  it("TC-418: tunnel autoStart=true successful install renders passed listing", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockResolvedValueOnce({} as never);
    const waitForApi = vi.fn(async () => true);
    const runTunnelUp = vi.fn(async () => ({
      installed: true,
      skippedReason: null,
    }));

    await runClusterStart(
      config,
      {},
      {
        waitForApi,
        loadTunnelConfig: () => ({
          autoStart: true,
          baseDomain: "agent-ix.dev",
          tunnelId: null,
        }),
        runTunnelUp,
      },
    );

    expect(runTunnelUp).toHaveBeenCalledWith(config, { requireToken: false });
    const tunnel = calls.find(
      (c) => c.header === "ix local cluster start · tunnel",
    );
    expect(tunnel).toBeDefined();
    expect(tunnel!.status).toBe("passed");
    expect(tunnel!.tail).toEqual(expect.stringContaining("cloudflared"));
  });

  it("TC-420: tunnel install failures are warned and swallowed", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ix-control-plane\n" } as never);
    mockExeca.mockResolvedValueOnce({} as never);
    const waitForApi = vi.fn(async () => true);

    await runClusterStart(
      config,
      {},
      {
        waitForApi,
        loadTunnelConfig: () => ({
          autoStart: true,
          baseDomain: "agent-ix.dev",
          tunnelId: null,
        }),
        runTunnelUp: vi.fn(async () => {
          throw new Error("helm failed");
        }),
      },
    );

    const tunnel = calls.find(
      (c) => c.header === "ix local cluster start · tunnel",
    );
    expect(tunnel).toBeDefined();
    expect(tunnel!.status).toBe("failed");
    expect(tunnel!.tailVariant).toBe("warn");
    expect(tunnel!.tail).toEqual(expect.stringContaining("helm failed"));
  });
});
