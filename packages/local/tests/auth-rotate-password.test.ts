/**
 * FR-041 — `ix local auth rotate-password` unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

import * as ui from "@agent-ix/ix-ui-cli";
import {
  runAuthRotatePassword,
  type RotatePasswordDeps,
} from "../src/commands/auth-rotate-password.js";

const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;
const mockConfig = { internalBaseDomain: "dev.ix" } as never;

const CURRENT_PW = "TEMP-PW-DO-NOT-LEAK-AAA";
const NEW_PW = "NEW-PW-DO-NOT-LEAK-BBB";

function notesIn(): string[] {
  return calls.flatMap((c) => [
    ...c.notes,
    ...c.infos.map(
      (i) => `${String(i.name ?? "")} ${String(i.description ?? "")}`,
    ),
    ...(typeof c.tail === "string" ? [c.tail] : []),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetListings();
});

function makeDeps(rawFn: RotatePasswordDeps["kubectlRaw"]): RotatePasswordDeps {
  return {
    kubectlRaw: rawFn,
    readStdinLines: async (n) => [CURRENT_PW, NEW_PW].slice(0, n),
    generatePassword: () => NEW_PW,
    writeStderr: () => {},
  };
}

describe("runAuthRotatePassword — happy path", () => {
  it("calls /token then /users/me/password/rotate with Bearer", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { rotate_token: "ROT-TOKEN" },
      })
      .mockResolvedValueOnce({ status: 204, body: null });

    await runAuthRotatePassword(
      mockConfig,
      "alice@example.com",
      {
        currentPasswordStdin: true,
        newPasswordStdin: true,
        generate: false,
        showGenerated: false,
      },
      makeDeps(raw),
    );

    expect(raw).toHaveBeenCalledTimes(2);
    // Call 1: /token, form grant
    const [, path1, method1, body1, opts1] = raw.mock.calls[0] as [
      string,
      string,
      string,
      unknown,
      { deployment?: string; form?: Record<string, string> },
    ];
    expect(path1).toBe("/api/v1/token");
    expect(method1).toBe("POST");
    expect(body1).toBeUndefined();
    expect(opts1.deployment).toBe("auth-service");
    expect(opts1.form?.grant_type).toBe("password");
    expect(opts1.form?.username).toBe("alice@example.com");
    expect(opts1.form?.password).toBe(CURRENT_PW);

    // Call 2: /users/me/password/rotate with Bearer
    const [, path2, method2, body2, opts2] = raw.mock.calls[1] as [
      string,
      string,
      string,
      { new_password: string },
      { headers?: Record<string, string> },
    ];
    expect(path2).toBe("/users/me/password/rotate");
    expect(method2).toBe("POST");
    expect(body2.new_password).toBe(NEW_PW);
    expect(opts2.headers?.Authorization).toBe("Bearer ROT-TOKEN");
  });
});

describe("runAuthRotatePassword — error paths", () => {
  it("401 on /token", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, body: { detail: "bad creds" } });
    await expect(
      runAuthRotatePassword(
        mockConfig,
        "u",
        {
          currentPasswordStdin: true,
          newPasswordStdin: true,
          generate: false,
          showGenerated: false,
        },
        makeDeps(raw),
      ),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("/token without rotate_token suggests reset-user", async () => {
    const raw = vi.fn().mockResolvedValueOnce({
      status: 200,
      body: { access_token: "normal" },
    });
    await expect(
      runAuthRotatePassword(
        mockConfig,
        "u",
        {
          currentPasswordStdin: true,
          newPasswordStdin: true,
          generate: false,
          showGenerated: false,
        },
        makeDeps(raw),
      ),
    ).rejects.toThrow(/reset-user/);
  });

  it("400 password_policy from rotate step surfaces detail", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { rotate_token: "ROT" },
      })
      .mockResolvedValueOnce({
        status: 400,
        body: {
          detail: {
            error: "password_policy",
            detail: "Password must be at least 12 characters",
          },
        },
      });
    await expect(
      runAuthRotatePassword(
        mockConfig,
        "u",
        {
          currentPasswordStdin: true,
          newPasswordStdin: true,
          generate: false,
          showGenerated: false,
        },
        makeDeps(raw),
      ),
    ).rejects.toThrow(/at least 12 characters/);
  });

  it("propagates a transport error from the second call", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { rotate_token: "ROT" },
      })
      .mockRejectedValueOnce(new Error("kubectl exec → identity HTTP failed"));
    await expect(
      runAuthRotatePassword(
        mockConfig,
        "u",
        {
          currentPasswordStdin: true,
          newPasswordStdin: true,
          generate: false,
          showGenerated: false,
        },
        makeDeps(raw),
      ),
    ).rejects.toThrow(/kubectl exec/);
  });
});

describe("runAuthRotatePassword — flag enforcement", () => {
  it("requires --current-password-stdin", async () => {
    await expect(
      runAuthRotatePassword(
        mockConfig,
        "u",
        {
          currentPasswordStdin: false,
          newPasswordStdin: true,
          generate: false,
          showGenerated: false,
        },
        makeDeps(vi.fn()),
      ),
    ).rejects.toThrow(/--current-password-stdin is required/);
  });

  it("requires exactly one new-password mode", async () => {
    await expect(
      runAuthRotatePassword(
        mockConfig,
        "u",
        {
          currentPasswordStdin: true,
          newPasswordStdin: false,
          generate: false,
          showGenerated: false,
        },
        makeDeps(vi.fn()),
      ),
    ).rejects.toThrow(/Exactly one/);
  });
});

describe("runAuthRotatePassword — passwords never leak", () => {
  it("neither current nor new password appears in argv/notes/stderr", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { rotate_token: "ROT" },
      })
      .mockResolvedValueOnce({ status: 204, body: null });

    const stderr: string[] = [];
    await runAuthRotatePassword(
      mockConfig,
      "alice@example.com",
      {
        currentPasswordStdin: true,
        newPasswordStdin: true,
        generate: false,
        showGenerated: false,
      },
      {
        kubectlRaw: raw,
        readStdinLines: async () => [CURRENT_PW, NEW_PW],
        generatePassword: () => NEW_PW,
        writeStderr: (s) => stderr.push(s),
      },
    );

    // Top-level argv args (namespace + path + method) never carry passwords.
    for (const call of raw.mock.calls) {
      const argvArgs = call.slice(0, 3);
      for (const a of argvArgs) {
        expect(String(a)).not.toContain(CURRENT_PW);
        expect(String(a)).not.toContain(NEW_PW);
      }
    }
    const combined = [...stderr, ...notesIn()].join("\n");
    expect(combined).not.toContain(CURRENT_PW);
    expect(combined).not.toContain(NEW_PW);
  });
});
