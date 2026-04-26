/**
 * TC-032–TC-038: runClusterDown()
 * FR-006, NFR-002 (destructive confirmation guard)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa");
vi.mock("@clack/prompts");
vi.mock("@agent-ix/ix-ui-cli");

import { execa } from "execa";
import * as p from "@clack/prompts";
import { outroSuccess, outroError } from "@agent-ix/ix-ui-cli";
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
  ghcrToken: null,
  certManagerVersion: "v1.14.5",
  certManagerTimeoutSeconds: 180,
  certWaitTimeoutSeconds: 120,
  rolloutTimeoutSeconds: 300,
};

const mockExeca = vi.mocked(execa);
const mockConfirm = vi.mocked(p.confirm);
const mockIsCancel = vi.mocked(p.isCancel);
const mockOutroSuccess = vi.mocked(outroSuccess);
const mockOutroError = vi.mocked(outroError);

// kind get clusters returns the cluster name — cluster exists
function stubClusterExists() {
  mockExeca.mockResolvedValueOnce({ stdout: "ix\nother-cluster\n" } as never);
}

// kind get clusters returns empty — cluster absent
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
    mockExeca.mockResolvedValueOnce({} as never); // kind delete cluster

    await runClusterDown(config, { yes: true });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockExeca).toHaveBeenCalledWith(
      "kind",
      ["delete", "cluster", "--name", "ix"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("TC-033: prompt returns false — no deletion, success outro", async () => {
    mockConfirm.mockResolvedValueOnce(false as never);
    mockIsCancel.mockReturnValue(false);

    await runClusterDown(config);

    expect(mockExeca).not.toHaveBeenCalled();
    expect(mockOutroSuccess).toHaveBeenCalledWith(
      expect.stringContaining("Cancelled"),
    );
  });

  it("TC-034: prompt cancelled (isCancel) — no deletion, success outro", async () => {
    const cancelSymbol = Symbol("cancel");
    mockConfirm.mockResolvedValueOnce(cancelSymbol as never);
    mockIsCancel.mockReturnValue(true);

    await runClusterDown(config);

    expect(mockExeca).not.toHaveBeenCalled();
    expect(mockOutroSuccess).toHaveBeenCalled();
  });

  it("TC-035: cluster does not exist — exits cleanly without deletion", async () => {
    mockConfirm.mockResolvedValueOnce(true as never);
    stubClusterAbsent();

    await runClusterDown(config, { yes: true });

    const deleteCalls = mockExeca.mock.calls.filter(
      (args) => args[0] === "kind" && (args[1] as string[]).includes("delete"),
    );
    expect(deleteCalls).toHaveLength(0);
    expect(mockOutroSuccess).toHaveBeenCalledWith(
      expect.stringContaining("does not exist"),
    );
  });

  it("TC-036: kind delete cluster fails — outroError called and error rethrown", async () => {
    stubClusterExists();
    const boom = new Error("kind: failed to delete");
    mockExeca.mockRejectedValueOnce(boom as never);

    await expect(runClusterDown(config, { yes: true })).rejects.toThrow(boom);
    expect(mockOutroError).toHaveBeenCalled();
  });

  it("TC-037: no helm uninstall called during cluster down", async () => {
    stubClusterExists();
    mockExeca.mockResolvedValueOnce({} as never); // kind delete

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
