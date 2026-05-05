import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

vi.mock("../src/commands/auth-secret.js", () => ({
  writeAdminBootstrapSecret: vi.fn(),
}));

import * as ui from "@agent-ix/ix-ui-cli";
import { writeAdminBootstrapSecret } from "../src/commands/auth-secret.js";
import { KubectlExecError } from "../src/commands/auth-identity.js";
import { runAuthResetAdmin } from "../src/commands/auth-reset-admin.js";

const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;
const mockWriteSecret = vi.mocked(writeAdminBootstrapSecret);

const mockConfig = { internalBaseDomain: "dev.ix" } as never;

function makeExecError(exitCode: number, stderr = ""): KubectlExecError {
  return new KubectlExecError("kubectl exec failed", exitCode, "", stderr);
}

const resetResp = {
  user_id: "u1",
  email: "admin@dev.ix",
  username: "admin",
  password: "new-pass",
  expires_at: "2026-05-01T00:00:00+00:00",
  login_url: "https://identity.dev.ix/login",
};

function notesIn(): string[] {
  return calls.flatMap((c) => c.notes);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetListings();
});

describe("runAuthResetAdmin — happy path", () => {
  it("calls reset-admin, writes the secret, and prints credentials", async () => {
    const mockExec = vi.fn().mockResolvedValueOnce(resetResp);

    await runAuthResetAdmin(mockConfig, {}, { kubectlExecJson: mockExec });

    expect(mockExec).toHaveBeenCalledTimes(1);
    const [, , argv] = mockExec.mock.calls[0] as [unknown, unknown, string[]];
    expect(argv).toContain("reset-admin");
    expect(argv).toContain("--new-email");
    expect(argv).toContain("admin@dev.ix");
    expect(mockWriteSecret).toHaveBeenCalledWith(
      expect.objectContaining({ password: "new-pass" }),
    );
    const notes = notesIn();
    expect(notes.some((n) => n.includes("new-pass"))).toBe(true);
    expect(notes.some((n) => n.includes("admin@dev.ix"))).toBe(true);
    expect(notes.some((n) => n.includes("u1"))).toBe(true);
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
    const [, , fallbackArgv] = mockExec.mock.calls[1] as [
      unknown,
      unknown,
      string[],
    ];
    expect(fallbackArgv).toContain("init-admin");
    expect(fallbackArgv).toContain("--email");
    expect(fallbackArgv).toContain("admin@dev.ix");
    expect(mockWriteSecret).toHaveBeenCalledWith(
      expect.objectContaining({ password: "init-pass" }),
    );
    expect(notesIn().some((n) => n.includes("init-pass"))).toBe(true);
  });

  it("prints 'admin' as username/email fallback when init-admin response omits them", async () => {
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

    expect(notesIn().some((n) => n.includes("admin"))).toBe(true);
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
