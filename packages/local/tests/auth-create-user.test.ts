/**
 * FR-043 — `ix local auth create-user` orchestrator unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

import * as ui from "@agent-ix/ix-ui-cli";
import {
  runAuthCreateUser,
  type CreateUserDeps,
} from "../src/commands/auth-create-user.js";

const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;
const mockConfig = { internalBaseDomain: "dev.ix" } as never;

const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const EMAIL = "testbot@agent-ix.local";
const PASSWORD_SENTINEL = "GENPW-DO-NOT-LEAK-XYZ";
const INVITE_TOKEN = "INVITE-TOKEN-SENTINEL";

function notesIn(): string[] {
  return calls.flatMap((c) => [
    ...c.notes,
    ...c.infos.map(
      (i) => `${String(i.name ?? "")} ${String(i.description ?? "")}`,
    ),
    ...(typeof c.tail === "string" ? [c.tail] : []),
  ]);
}

function defaultDeps(overrides: Partial<CreateUserDeps> = {}): CreateUserDeps {
  return {
    generatePassword: () => PASSWORD_SENTINEL,
    readStdinLine: async () => "",
    whichBinary: async () => false,
    saveToVault: vi.fn(),
    writeStderr: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetListings();
});

describe("runAuthCreateUser — happy path without vault", () => {
  it("invites then accepts, prints user+tenant, vault not saved", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({
        status: 201,
        body: {
          user_id: "u1",
          email: EMAIL,
          invite_url: `https://x/invite?token=${INVITE_TOKEN}`,
          invite_token: INVITE_TOKEN,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { user_id: "u1", tenant_id: TENANT },
      });

    await runAuthCreateUser(
      mockConfig,
      EMAIL,
      {
        tenantId: TENANT,
        passwordStdin: false,
        noSaveVault: true,
      },
      defaultDeps({ kubectlRaw: raw }),
    );

    expect(raw).toHaveBeenCalledTimes(2);
    const [, p1] = raw.mock.calls[0] as [string, string];
    const [, p2, , body2] = raw.mock.calls[1] as [
      string,
      string,
      string,
      { invite_token: string; password: string },
    ];
    expect(p1).toBe("/internal/users/invite");
    expect(p2).toBe("/internal/users/accept-invite");
    expect(body2.invite_token).toBe(INVITE_TOKEN);
    expect(body2.password).toBe(PASSWORD_SENTINEL);
    const ns = notesIn().join("\n");
    expect(ns).toContain("u1");
    expect(ns).toContain(TENANT);
    expect(ns).toContain("not saved");
  });
});

describe("runAuthCreateUser — happy path with vault", () => {
  it("invokes saveToVault when agent-browser is on PATH", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({
        status: 201,
        body: {
          user_id: "u1",
          email: EMAIL,
          invite_token: INVITE_TOKEN,
          invite_url: "",
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { user_id: "u1", tenant_id: TENANT },
      });
    const saveToVault = vi.fn().mockResolvedValue(undefined);

    await runAuthCreateUser(
      mockConfig,
      EMAIL,
      {
        tenantId: TENANT,
        passwordStdin: false,
        noSaveVault: false,
      },
      defaultDeps({
        kubectlRaw: raw,
        whichBinary: async () => true,
        saveToVault,
      }),
    );

    expect(saveToVault).toHaveBeenCalledTimes(1);
    const arg = saveToVault.mock.calls[0][0] as {
      vaultName: string;
      email: string;
      password: string;
    };
    expect(arg.vaultName).toBe("testbot");
    expect(arg.email).toBe(EMAIL);
    expect(arg.password).toBe(PASSWORD_SENTINEL);
  });
});

describe("runAuthCreateUser — agent-browser missing", () => {
  it("skips vault save silently via stderr note", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({
        status: 201,
        body: {
          user_id: "u1",
          email: EMAIL,
          invite_token: INVITE_TOKEN,
          invite_url: "",
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { user_id: "u1", tenant_id: TENANT },
      });
    const stderr: string[] = [];

    await runAuthCreateUser(
      mockConfig,
      EMAIL,
      { tenantId: TENANT, passwordStdin: false, noSaveVault: false },
      defaultDeps({
        kubectlRaw: raw,
        whichBinary: async () => false,
        writeStderr: (s) => stderr.push(s),
      }),
    );

    expect(stderr.join("")).toMatch(/agent-browser not on PATH/);
  });
});

describe("runAuthCreateUser — invite step fails", () => {
  it("does not call accept-invite when invite fails", async () => {
    const raw = vi.fn().mockResolvedValueOnce({
      status: 409,
      body: { error: "user_exists" },
    });
    await expect(
      runAuthCreateUser(
        mockConfig,
        EMAIL,
        { tenantId: TENANT, passwordStdin: false, noSaveVault: true },
        defaultDeps({ kubectlRaw: raw }),
      ),
    ).rejects.toThrow(/invite failed/);
    expect(raw).toHaveBeenCalledTimes(1);
  });
});

describe("runAuthCreateUser — accept fails after invite", () => {
  it("emits recovery hint and re-raises", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({
        status: 201,
        body: {
          user_id: "u1",
          email: EMAIL,
          invite_token: INVITE_TOKEN,
          invite_url: "",
        },
      })
      .mockResolvedValueOnce({
        status: 400,
        body: { detail: { error: "invalid_token" } },
      });
    const stderr: string[] = [];
    await expect(
      runAuthCreateUser(
        mockConfig,
        EMAIL,
        { tenantId: TENANT, passwordStdin: false, noSaveVault: true },
        defaultDeps({
          kubectlRaw: raw,
          writeStderr: (s) => stderr.push(s),
        }),
      ),
    ).rejects.toThrow(/accept-invite failed/);
    const hint = stderr.join("");
    expect(hint).toContain(INVITE_TOKEN);
    expect(hint).toContain("uninvite");
  });
});

describe("runAuthCreateUser — password never leaks", () => {
  it("password sentinel never appears in argv/notes/stderr", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce({
        status: 201,
        body: {
          user_id: "u1",
          email: EMAIL,
          invite_token: INVITE_TOKEN,
          invite_url: "",
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { user_id: "u1", tenant_id: TENANT },
      });
    const stderr: string[] = [];
    await runAuthCreateUser(
      mockConfig,
      EMAIL,
      { tenantId: TENANT, passwordStdin: false, noSaveVault: true },
      defaultDeps({
        kubectlRaw: raw,
        writeStderr: (s) => stderr.push(s),
      }),
    );
    for (const call of raw.mock.calls) {
      const argvArgs = call.slice(0, 3);
      for (const a of argvArgs) {
        expect(String(a)).not.toContain(PASSWORD_SENTINEL);
      }
    }
    const combined = [...stderr, ...notesIn()].join("\n");
    expect(combined).not.toContain(PASSWORD_SENTINEL);
  });
});
