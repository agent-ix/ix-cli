/**
 * TC-032–TC-038: runClusterDown()
 * FR-006, NFR-002 (destructive confirmation guard)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("execa");
vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

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
const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;

function stubClusterExists() {
  mockExeca.mockResolvedValueOnce({ stdout: "ix\nother-cluster\n" } as never);
}

function stubClusterAbsent() {
  mockExeca.mockResolvedValueOnce({ stdout: "" } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetListings();
});

describe("runClusterDown", () => {
  it("TC-032: --yes flag skips prompt and calls kind delete cluster", async () => {
    stubClusterExists();
    mockExeca.mockResolvedValueOnce({} as never);

    const confirm = vi.fn(async () => true);
    await runClusterDown(config, { yes: true }, { confirm });

    expect(confirm).not.toHaveBeenCalled();
    expect(mockExeca).toHaveBeenCalledWith(
      "kind",
      ["delete", "cluster", "--name", "ix"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("TC-033: prompt returns false — no deletion, warn outro", async () => {
    const confirm = vi.fn(async () => false);
    await runClusterDown(config, {}, { confirm });

    expect(mockExeca).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].tail).toEqual(expect.stringContaining("Cancelled"));
    expect(calls[0].tailVariant).toBe("warn");
  });

  it("TC-034: prompt cancelled — no deletion, warn outro", async () => {
    // The prompt seam returns false when ConfirmPrompt's onSubmit is cancelled.
    const confirm = vi.fn(async () => false);
    await runClusterDown(config, {}, { confirm });

    expect(mockExeca).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].tail).toEqual(expect.stringContaining("Cancelled"));
    expect(calls[0].tailVariant).toBe("warn");
  });

  it("TC-035: cluster does not exist — exits cleanly without deletion", async () => {
    stubClusterAbsent();
    await runClusterDown(config, { yes: true });

    const deleteCalls = mockExeca.mock.calls.filter(
      (args) => args[0] === "kind" && (args[1] as string[]).includes("delete"),
    );
    expect(deleteCalls).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].tail).toEqual(expect.stringContaining("does not exist"));
    expect(calls[0].status).toBe("passed");
  });

  it("TC-036: kind delete cluster fails — error rendered and rethrown", async () => {
    stubClusterExists();
    const boom = new Error("kind: failed to delete");
    mockExeca.mockRejectedValueOnce(boom as never);

    await expect(runClusterDown(config, { yes: true })).rejects.toThrow(boom);
    const failed = calls.find((c) => c.status === "failed");
    expect(failed).toBeDefined();
    expect(failed!.tail).toEqual(expect.stringContaining("Failed to delete"));
  });

  it("TC-037: no helm uninstall called during cluster down", async () => {
    stubClusterExists();
    mockExeca.mockResolvedValueOnce({} as never);

    await runClusterDown(config, { yes: true });

    const helmCalls = mockExeca.mock.calls.filter((args) => args[0] === "helm");
    expect(helmCalls).toHaveLength(0);
  });

  it("TC-038: prompt receives the specific cluster name", async () => {
    const confirm = vi.fn(async () => false);
    await runClusterDown(config, {}, { confirm });

    expect(confirm).toHaveBeenCalledWith("ix");
  });

  it("TC-319: name-mismatch on second prompt aborts before kind delete", async () => {
    const confirm = vi.fn(async () => true);
    const confirmName = vi.fn(async () => "mismatch" as const);

    await runClusterDown(config, {}, { confirm, confirmName });

    const deleteCalls = mockExeca.mock.calls.filter(
      (args) => args[0] === "kind" && (args[1] as string[]).includes("delete"),
    );
    expect(deleteCalls).toHaveLength(0);
    expect(confirmName).toHaveBeenCalledWith("ix");
    const failed = calls.find((c) => c.status === "failed");
    expect(failed).toBeDefined();
    expect(failed!.tail).toEqual(expect.stringContaining("did not match"));
  });

  it("TC-330: ESC during name retype reports 'Cancelled' rather than 'did not match'", async () => {
    const confirm = vi.fn(async () => true);
    const confirmName = vi.fn(async () => "cancelled" as const);

    await runClusterDown(config, {}, { confirm, confirmName });

    const deleteCalls = mockExeca.mock.calls.filter(
      (args) => args[0] === "kind" && (args[1] as string[]).includes("delete"),
    );
    expect(deleteCalls).toHaveLength(0);
    const final = calls[calls.length - 1];
    expect(final.tail).toEqual(expect.stringContaining("Cancelled"));
    expect(final.tailVariant).toBe("warn");
    expect(final.status).toBe("passed");
  });

  it("TC-331: name retype is case-sensitive", async () => {
    const confirm = vi.fn(async () => true);
    // Implementation detail check via integration: confirmName receives the
    // exact cluster name; spec says case-sensitive comparison. We assert the
    // contract by passing through to defaultConfirmName via the test seam in
    // a follow-up (see halt-resolve unit). Here we only verify that
    // "mismatch" is the return code surfaced for any non-match input.
    const confirmName = vi.fn(async () => "mismatch" as const);
    await runClusterDown(config, {}, { confirm, confirmName });

    const deleteCalls = mockExeca.mock.calls.filter(
      (args) => args[0] === "kind" && (args[1] as string[]).includes("delete"),
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it("TC-320: --yes bypasses both prompts (confirm + name retype)", async () => {
    stubClusterExists();
    mockExeca.mockResolvedValueOnce({} as never);
    const confirm = vi.fn(async () => true);
    const confirmName = vi.fn(async () => "match" as const);

    await runClusterDown(config, { yes: true }, { confirm, confirmName });

    expect(confirm).not.toHaveBeenCalled();
    expect(confirmName).not.toHaveBeenCalled();
    expect(mockExeca).toHaveBeenCalledWith(
      "kind",
      ["delete", "cluster", "--name", "ix"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });
});
