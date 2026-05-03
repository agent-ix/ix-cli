/**
 * TC-032–TC-038: runClusterDown()
 * FR-006, NFR-002 (destructive confirmation guard)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa");
vi.mock("@agent-ix/ix-ui-cli", async () => {
  const success = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const pause = vi.fn(async (fn: () => unknown) => await fn());
  return {
    confirm: vi.fn(),
    isCancel: vi.fn(() => false),
    startListing: vi.fn(() => ({
      group: vi.fn(),
      item: vi.fn(),
      note: vi.fn(),
      raw: vi.fn(),
      commit: vi.fn(),
      pause,
      success,
      warn,
      error,
    })),
    __success: success,
    __warn: warn,
    __error: error,
    __pause: pause,
  };
});

import { execa } from "execa";
import * as ui from "@agent-ix/ix-ui-cli";
import { runClusterDown } from "../src/commands/cluster-down.js";
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
const mockConfirm = vi.mocked(ui.confirm);
const mockIsCancel = vi.mocked(ui.isCancel);
type Bag = typeof ui & {
  __success: ReturnType<typeof vi.fn>;
  __warn: ReturnType<typeof vi.fn>;
  __error: ReturnType<typeof vi.fn>;
};
const mockSuccess = (ui as unknown as Bag).__success;
const mockWarn = (ui as unknown as Bag).__warn;
const mockError = (ui as unknown as Bag).__error;

function stubClusterExists() {
  mockExeca.mockResolvedValueOnce({ stdout: "ix\nother-cluster\n" } as never);
}

function stubClusterAbsent() {
  mockExeca.mockResolvedValueOnce({ stdout: "" } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCancel.mockReturnValue(false);
});

describe("runClusterDown", () => {
  it("TC-032: --yes flag skips prompt and calls kind delete cluster", async () => {
    stubClusterExists();
    mockExeca.mockResolvedValueOnce({} as never);

    await runClusterDown(config, { yes: true });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockExeca).toHaveBeenCalledWith(
      "kind",
      ["delete", "cluster", "--name", "ix"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("TC-033: prompt returns false — no deletion, warn outro", async () => {
    mockConfirm.mockResolvedValueOnce(false as never);
    mockIsCancel.mockReturnValue(false);

    await runClusterDown(config);

    expect(mockExeca).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
  });

  it("TC-034: prompt cancelled (isCancel) — no deletion, warn outro", async () => {
    const cancelSymbol = Symbol("cancel");
    mockConfirm.mockResolvedValueOnce(cancelSymbol as never);
    mockIsCancel.mockReturnValue(true);

    await runClusterDown(config);

    expect(mockExeca).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalled();
  });

  it("TC-035: cluster does not exist — exits cleanly without deletion", async () => {
    mockConfirm.mockResolvedValueOnce(true as never);
    stubClusterAbsent();

    await runClusterDown(config, { yes: true });

    const deleteCalls = mockExeca.mock.calls.filter(
      (args) => args[0] === "kind" && (args[1] as string[]).includes("delete"),
    );
    expect(deleteCalls).toHaveLength(0);
    expect(mockSuccess).toHaveBeenCalledWith(
      expect.stringContaining("does not exist"),
    );
  });

  it("TC-036: kind delete cluster fails — error called and error rethrown", async () => {
    stubClusterExists();
    const boom = new Error("kind: failed to delete");
    mockExeca.mockRejectedValueOnce(boom as never);

    await expect(runClusterDown(config, { yes: true })).rejects.toThrow(boom);
    expect(mockError).toHaveBeenCalled();
  });

  it("TC-037: no helm uninstall called during cluster down", async () => {
    stubClusterExists();
    mockExeca.mockResolvedValueOnce({} as never);

    await runClusterDown(config, { yes: true });

    const helmCalls = mockExeca.mock.calls.filter((args) => args[0] === "helm");
    expect(helmCalls).toHaveLength(0);
  });

  it("TC-038: prompt message contains the specific cluster name", async () => {
    mockConfirm.mockResolvedValueOnce(false as never);

    await runClusterDown(config);

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("ix"),
      }),
    );
  });
});
