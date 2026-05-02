import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agent-ix/ix-ui-cli", () => {
  const note = vi.fn();
  const success = vi.fn();
  const error = vi.fn();
  return {
    startListing: vi.fn(() => ({ commit: vi.fn(), note, success, error })),
    makeListr: vi.fn(
      (tasks: Array<{ task: (ctx: object, t: object) => Promise<void> }>) => ({
        run: async () => {
          for (const t of tasks) {
            await t.task({}, { output: "" });
          }
        },
      }),
    ),
    __note: note,
    __success: success,
    __error: error,
  };
});

vi.mock("../src/commands/auth-secret.js", () => ({
  writeAdminBootstrapSecret: vi.fn(),
}));

import * as ui from "@agent-ix/ix-ui-cli";
import { writeAdminBootstrapSecret } from "../src/commands/auth-secret.js";
import { KubectlExecError } from "../src/commands/auth-identity.js";
import { runAuthInit } from "../src/commands/auth-init.js";

type UiBag = typeof ui & {
  __note: ReturnType<typeof vi.fn>;
  __success: ReturnType<typeof vi.fn>;
  __error: ReturnType<typeof vi.fn>;
};
const mockNote = (ui as unknown as UiBag).__note;
const mockSuccess = (ui as unknown as UiBag).__success;
const mockWriteSecret = vi.mocked(writeAdminBootstrapSecret);

const mockConfig = { internalBaseDomain: "dev.ix" } as never;

function makeExecError(exitCode: number, stderr = ""): KubectlExecError {
  return new KubectlExecError("kubectl exec failed", exitCode, "", stderr);
}

beforeEach(() => {
  vi.clearAllMocks();
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

    await runAuthInit(mockConfig, { kubectlExecJson: mockExec });

    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockWriteSecret).toHaveBeenCalledWith({
      password: "tmp-pass",
      expiresAt: "2026-05-01T00:00:00+00:00",
      userId: "u1",
      loginUrl: "https://identity.dev.ix/login",
    });
    expect(mockNote).toHaveBeenCalledWith(expect.stringContaining("admin"));
    expect(mockNote).toHaveBeenCalledWith(expect.stringContaining("tmp-pass"));
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("https://identity.dev.ix/login"),
    );
    expect(mockSuccess).toHaveBeenCalledWith("Admin account created.");
  });
});

describe("runAuthInit — admin already exists (exit 2)", () => {
  it("prints an already-exists note and does NOT write a secret", async () => {
    const mockExec = vi.fn().mockRejectedValueOnce(makeExecError(2));

    await runAuthInit(mockConfig, { kubectlExecJson: mockExec });

    expect(mockWriteSecret).not.toHaveBeenCalled();
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("reset-admin"),
    );
    expect(mockSuccess).not.toHaveBeenCalled();
  });
});

describe("runAuthInit — database unreachable (exit 3)", () => {
  it("throws with an identity database unreachable message", async () => {
    const mockExec = vi
      .fn()
      .mockRejectedValueOnce(makeExecError(3, "connection refused"));

    await expect(
      runAuthInit(mockConfig, { kubectlExecJson: mockExec }),
    ).rejects.toThrow(/identity database unreachable/);
  });
});

describe("runAuthInit — generic exec failure", () => {
  it("throws surfacing the exit code and stderr", async () => {
    const mockExec = vi
      .fn()
      .mockRejectedValueOnce(makeExecError(99, "something exploded"));

    await expect(
      runAuthInit(mockConfig, { kubectlExecJson: mockExec }),
    ).rejects.toThrow(/exit 99/);
  });
});
