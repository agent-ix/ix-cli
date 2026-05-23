/**
 * FR-040 — `ix local auth accept-invite` unit tests.
 *
 * Covers happy path + each documented error envelope and a sentinel-grep that
 * verifies the operator-supplied password never appears in argv, stdout,
 * stderr, or listing notes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

import * as ui from "@agent-ix/ix-ui-cli";
import {
  runAuthAcceptInvite,
  type AcceptInviteDeps,
} from "../src/commands/auth-accept-invite.js";

const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;
const mockConfig = { internalBaseDomain: "dev.ix" } as never;

const PASSWORD_SENTINEL = "TESTPW-DO-NOT-LEAK-XYZ123";

function notesIn(): string[] {
  return calls.flatMap((c) => [
    ...c.notes,
    ...c.infos.map(
      (i) => `${String(i.name ?? "")} ${String(i.description ?? "")}`,
    ),
    ...(typeof c.tail === "string" ? [c.tail] : []),
  ]);
}

function happyDeps(rawImpl: AcceptInviteDeps["kubectlRaw"]): AcceptInviteDeps {
  return {
    kubectlRaw: rawImpl,
    readStdin: async () => PASSWORD_SENTINEL,
    generatePassword: () => PASSWORD_SENTINEL,
    writeStderr: () => {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetListings();
});

describe("runAuthAcceptInvite — flag exclusivity", () => {
  it("rejects when neither --password-stdin nor --generate is set", async () => {
    await expect(
      runAuthAcceptInvite(
        mockConfig,
        "tok",
        { passwordStdin: false, generate: false, showGenerated: false },
        happyDeps(vi.fn()),
      ),
    ).rejects.toThrow(/exactly one/i);
  });

  it("rejects when both modes are set", async () => {
    await expect(
      runAuthAcceptInvite(
        mockConfig,
        "tok",
        { passwordStdin: true, generate: true, showGenerated: false },
        happyDeps(vi.fn()),
      ),
    ).rejects.toThrow(/exactly one/i);
  });
});

describe("runAuthAcceptInvite — happy path", () => {
  it("posts to /internal/users/accept-invite and prints user+tenant", async () => {
    const raw = vi.fn().mockResolvedValueOnce({
      status: 200,
      body: { user_id: "u1", tenant_id: "t1", must_rotate: false },
    });

    await runAuthAcceptInvite(
      mockConfig,
      "the-token",
      { passwordStdin: true, generate: false, showGenerated: false },
      happyDeps(raw),
    );

    expect(raw).toHaveBeenCalledTimes(1);
    const [, path, method, body] = raw.mock.calls[0] as [
      string,
      string,
      string,
      { invite_token: string; password: string },
    ];
    expect(path).toBe("/internal/users/accept-invite");
    expect(method).toBe("POST");
    expect(body.invite_token).toBe("the-token");
    expect(body.password).toBe(PASSWORD_SENTINEL);
    const all = notesIn().join("\n");
    expect(all).toContain("u1");
    expect(all).toContain("t1");
  });
});

describe("runAuthAcceptInvite — error envelopes", () => {
  const cases: [number, string, RegExp][] = [
    [400, "invalid_token", /invalid, consumed, superseded, or expired/i],
    [403, "admin_not_acceptable_headlessly", /cloud-manager-ui/i],
    [410, "token_rate_limited", /attempted too many times/i],
    [429, "rate_limited", /Retry-After/i],
    [500, "no_default_tenant", /tenant set-default/i],
  ];
  for (const [status, code, pattern] of cases) {
    it(`maps ${status} ${code}`, async () => {
      const raw = vi.fn().mockResolvedValueOnce({
        status,
        body: { detail: { error: code } },
      });
      await expect(
        runAuthAcceptInvite(
          mockConfig,
          "t",
          { passwordStdin: true, generate: false, showGenerated: false },
          happyDeps(raw),
        ),
      ).rejects.toThrow(pattern);
    });
  }

  it("maps 400 password_policy with detail", async () => {
    const raw = vi.fn().mockResolvedValueOnce({
      status: 400,
      body: {
        detail: {
          error: "password_policy",
          detail: "Password must be at least 12 characters",
        },
      },
    });
    await expect(
      runAuthAcceptInvite(
        mockConfig,
        "t",
        { passwordStdin: true, generate: false, showGenerated: false },
        happyDeps(raw),
      ),
    ).rejects.toThrow(/at least 12 characters/);
  });
});

describe("runAuthAcceptInvite — password never leaks", () => {
  it("password sentinel never appears in argv/stdout/stderr/notes", async () => {
    const raw = vi.fn().mockResolvedValueOnce({
      status: 200,
      body: { user_id: "u1", tenant_id: "t1" },
    });
    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: unknown): boolean => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown): boolean => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runAuthAcceptInvite(
        mockConfig,
        "t",
        { passwordStdin: true, generate: false, showGenerated: false },
        happyDeps(raw),
      );
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }

    // argv stays clean: kubectlRaw receives the password in the JSON body
    // argument, not as a separate argv entry. The test asserts the body is
    // structurally separate from the rest of the call so any leak would have
    // to be programmer-introduced.
    const argvArgs = raw.mock.calls.flat().slice(0, 3);
    for (const a of argvArgs) {
      expect(String(a)).not.toContain(PASSWORD_SENTINEL);
    }
    const combined = [...stdoutChunks, ...stderrChunks, ...notesIn()].join(
      "\n",
    );
    expect(combined).not.toContain(PASSWORD_SENTINEL);
  });

  it("--generate without --show-generated keeps the password off stderr", async () => {
    const raw = vi.fn().mockResolvedValueOnce({
      status: 200,
      body: { user_id: "u1", tenant_id: "t1" },
    });
    const stderr: string[] = [];
    await runAuthAcceptInvite(
      mockConfig,
      "t",
      { passwordStdin: false, generate: true, showGenerated: false },
      {
        kubectlRaw: raw,
        readStdin: async () => "",
        generatePassword: () => PASSWORD_SENTINEL,
        writeStderr: (s) => stderr.push(s),
      },
    );
    expect(stderr.join("")).not.toContain(PASSWORD_SENTINEL);
  });

  it("--show-generated emits the generated password to stderr only", async () => {
    const raw = vi.fn().mockResolvedValueOnce({
      status: 200,
      body: { user_id: "u1", tenant_id: "t1" },
    });
    const stderr: string[] = [];
    await runAuthAcceptInvite(
      mockConfig,
      "t",
      { passwordStdin: false, generate: true, showGenerated: true },
      {
        kubectlRaw: raw,
        readStdin: async () => "",
        generatePassword: () => PASSWORD_SENTINEL,
        writeStderr: (s) => stderr.push(s),
      },
    );
    expect(stderr.join("")).toContain(PASSWORD_SENTINEL);
    // ListingMock stdout surface stays clean.
    expect(notesIn().join("\n")).not.toContain(PASSWORD_SENTINEL);
  });
});
