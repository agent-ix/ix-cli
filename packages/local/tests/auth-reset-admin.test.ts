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
import { runAuthResetAdmin } from "../src/commands/auth-reset-admin.js";

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

const resetResp = {
  user_id: "u1",
  username: "admin",
  password: "new-pass",
  expires_at: "2026-05-01T00:00:00+00:00",
  login_url: "https://identity.dev.ix/login",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runAuthResetAdmin — happy path", () => {
  it("calls reset-admin, writes the secret, and prints credentials", async () => {
    const mockExec = vi.fn().mockResolvedValueOnce(resetResp);

    await runAuthResetAdmin(mockConfig, {}, { kubectlExecJson: mockExec });

    expect(mockExec).toHaveBeenCalledTimes(1);
    const [, , argv] = mockExec.mock.calls[0] as [unknown, unknown, string[]];
    expect(argv).toContain("reset-admin");
    expect(mockWriteSecret).toHaveBeenCalledWith(
      expect.objectContaining({ password: "new-pass" }),
    );
    expect(mockNote).toHaveBeenCalledWith(expect.stringContaining("new-pass"));
    expect(mockSuccess).toHaveBeenCalledWith("Admin password reset.");
  });

  it("passes --email when --user is provided", async () => {
    const mockExec = vi.fn().mockResolvedValueOnce(resetResp);

    await runAuthResetAdmin(
      mockConfig,
      { user: "alice@example.com" },
      { kubectlExecJson: mockExec },
    );

    const [, , argv] = mockExec.mock.calls[0] as [unknown, unknown, string[]];
    expect(argv).toContain("--email");
    expect(argv).toContain("alice@example.com");
  });
});

describe("runAuthResetAdmin — no admin exists (exit 4)", () => {
  it("falls back to init-admin and writes the secret", async () => {
    const initResp = {
      user_id: "u2",
      password: "init-pass",
      expires_at: "2026-05-01T00:00:00+00:00",
      login_url: "https://identity.dev.ix/login",
    };
    const mockExec = vi
      .fn()
      .mockRejectedValueOnce(makeExecError(4))
      .mockResolvedValueOnce(initResp);

    await runAuthResetAdmin(mockConfig, {}, { kubectlExecJson: mockExec });

    expect(mockExec).toHaveBeenCalledTimes(2);
    const [, , fallbackArgv] = mockExec.mock.calls[1] as [unknown, unknown, string[]];
    expect(fallbackArgv).toContain("init-admin");
    expect(mockWriteSecret).toHaveBeenCalledWith(
      expect.objectContaining({ password: "init-pass" }),
    );
    expect(mockNote).toHaveBeenCalledWith(expect.stringContaining("init-pass"));
    expect(mockSuccess).toHaveBeenCalledWith("Admin password reset.");
  });

  it("prints 'admin' as username when init-admin response omits it", async () => {
    const mockExec = vi
      .fn()
      .mockRejectedValueOnce(makeExecError(4))
      .mockResolvedValueOnce({
        user_id: "u2",
        password: "init-pass",
        expires_at: "2026-05-01T00:00:00+00:00",
        login_url: "https://identity.dev.ix/login",
      });

    await runAuthResetAdmin(mockConfig, {}, { kubectlExecJson: mockExec });

    expect(mockNote).toHaveBeenCalledWith(expect.stringContaining("admin"));
  });
});

describe("runAuthResetAdmin — multiple admins (exit 5)", () => {
  it("throws with candidate list", async () => {
    const stderr = JSON.stringify({
      error: "ambiguous_admin",
      candidates: ["admin@example.com", "root@example.com"],
    });
    const mockExec = vi.fn().mockRejectedValueOnce(makeExecError(5, stderr));

    await expect(
      runAuthResetAdmin(mockConfig, {}, { kubectlExecJson: mockExec }),
    ).rejects.toThrow(/admin@example.com/);
  });
});

describe("runAuthResetAdmin — database unreachable (exit 3)", () => {
  it("throws with an identity database unreachable message", async () => {
    const mockExec = vi
      .fn()
      .mockRejectedValueOnce(makeExecError(3, "connection refused"));

    await expect(
      runAuthResetAdmin(mockConfig, {}, { kubectlExecJson: mockExec }),
    ).rejects.toThrow(/identity database unreachable/);
  });
});
