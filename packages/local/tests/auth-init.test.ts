import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

vi.mock("../src/commands/auth-secret.js", () => ({
  writeAdminBootstrapSecret: vi.fn(),
}));

import * as ui from "@agent-ix/ix-ui-cli";
import { writeAdminBootstrapSecret } from "../src/commands/auth-secret.js";
import { KubectlExecError } from "../src/commands/auth-identity.js";
import { runAuthInit } from "../src/commands/auth-init.js";

const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;
const mockWriteSecret = vi.mocked(writeAdminBootstrapSecret);

const mockConfig = { internalBaseDomain: "dev.ix" } as never;

function makeExecError(exitCode: number, stderr = ""): KubectlExecError {
  return new KubectlExecError("kubectl exec failed", exitCode, "", stderr);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetListings();
});

describe("runAuthInit — happy path", () => {
  it("calls init-admin, writes the secret, and prints credentials", async () => {
    const seedResp = {
      user_id: "u1",
      password: "tmp-pass",
      expires_at: "2026-05-01T00:00:00+00:00",
      login_url: "https://identity.dev.ix/login",
    };
    const mockExec = vi.fn().mockResolvedValueOnce(seedResp);

    await runAuthInit(mockConfig, {
      kubectlExecJson: mockExec,
      hasIdentityDeployment: vi.fn().mockResolvedValue(true),
    });

    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockWriteSecret).toHaveBeenCalledWith({
      password: "tmp-pass",
      expiresAt: "2026-05-01T00:00:00+00:00",
      userId: "u1",
      loginUrl: "https://identity.dev.ix/login",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe("passed");
    expect(calls[0].tail).toBe("Admin account created.");
    expect(calls[0].notes.some((n) => n.includes("admin"))).toBe(true);
    expect(calls[0].notes.some((n) => n.includes("tmp-pass"))).toBe(true);
    expect(
      calls[0].notes.some((n) => n.includes("https://identity.dev.ix/login")),
    ).toBe(true);
  });
});

describe("runAuthInit — admin already exists (exit 2)", () => {
  it("prints an already-exists tail and does NOT write a secret", async () => {
    const mockExec = vi.fn().mockRejectedValueOnce(makeExecError(2));

    await runAuthInit(mockConfig, {
      kubectlExecJson: mockExec,
      hasIdentityDeployment: vi.fn().mockResolvedValue(true),
    });

    expect(mockWriteSecret).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].tail).toEqual(expect.stringContaining("reset-admin"));
    expect(calls[0].tailVariant).toBe("warn");
  });
});

describe("runAuthInit — database unreachable (exit 3)", () => {
  it("throws with an identity database unreachable message", async () => {
    const mockExec = vi
      .fn()
      .mockRejectedValueOnce(makeExecError(3, "connection refused"));

    await expect(
      runAuthInit(mockConfig, {
        kubectlExecJson: mockExec,
        hasIdentityDeployment: vi.fn().mockResolvedValue(true),
      }),
    ).rejects.toThrow(/identity database unreachable/);
  });
});

describe("runAuthInit — identity deployment missing", () => {
  it("starts auth once before init-admin when identity is absent", async () => {
    const seedResp = {
      user_id: "u1",
      password: "tmp-pass",
      expires_at: "2026-05-01T00:00:00+00:00",
      login_url: "https://identity.dev.ix/login",
    };
    const mockExec = vi.fn().mockResolvedValueOnce(seedResp);
    const mockEnsureIdentity = vi.fn().mockResolvedValue(undefined);
    const mockHasIdentity = vi.fn().mockResolvedValue(false);

    await runAuthInit(mockConfig, {
      kubectlExecJson: mockExec,
      ensureIdentityDeployment: mockEnsureIdentity,
      hasIdentityDeployment: mockHasIdentity,
    });

    expect(mockHasIdentity).toHaveBeenCalledTimes(1);
    expect(mockEnsureIdentity).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockWriteSecret).toHaveBeenCalledWith({
      password: "tmp-pass",
      expiresAt: "2026-05-01T00:00:00+00:00",
      userId: "u1",
      loginUrl: "https://identity.dev.ix/login",
    });
    expect(calls.at(-1)?.tail).toBe("Admin account created.");
  });
});

describe("runAuthInit — generic exec failure", () => {
  it("throws surfacing the exit code and stderr", async () => {
    const mockExec = vi
      .fn()
      .mockRejectedValueOnce(makeExecError(99, "something exploded"));

    await expect(
      runAuthInit(mockConfig, {
        kubectlExecJson: mockExec,
        hasIdentityDeployment: vi.fn().mockResolvedValue(true),
      }),
    ).rejects.toThrow(/exit 99/);
  });
});

describe("runAuthInit — identity still missing after bootstrap", () => {
  it("fails clearly if init-admin still cannot find identity", async () => {
    const mockExec = vi
      .fn()
      .mockRejectedValueOnce(
        makeExecError(
          1,
          'Error from server (NotFound): deployments.apps "identity" not found',
        ),
      );

    await expect(
      runAuthInit(mockConfig, {
        kubectlExecJson: mockExec,
        ensureIdentityDeployment: vi.fn().mockResolvedValue(undefined),
        hasIdentityDeployment: vi.fn().mockResolvedValue(false),
      }),
    ).rejects.toThrow(/identity deployment missing after auth bootstrap/);
  });
});
