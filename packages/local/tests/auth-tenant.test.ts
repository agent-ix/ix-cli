/**
 * FR-042 — `ix local auth tenant {list,add,set-default,remove}` unit tests.
 *
 * One happy path + one important error per verb. Email→user_id resolution
 * is exercised by every verb via the shared `resolveUserIdByEmail` helper.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

import * as ui from "@agent-ix/ix-ui-cli";
import {
  runAuthTenantAdd,
  runAuthTenantList,
  runAuthTenantRemove,
  runAuthTenantSetDefault,
} from "../src/commands/auth-tenant.js";

const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;
const mockConfig = { internalBaseDomain: "dev.ix" } as never;

const USER_ID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const EMAIL = "alice@example.com";

function userLookupOk() {
  return {
    status: 200,
    body: {
      user_id: USER_ID,
      email: EMAIL,
      username: "alice",
      display_name: "Alice",
      status: "active",
      default_tenant_id: null,
    },
  };
}

function userLookupNotFound() {
  return {
    status: 404,
    body: { detail: { error: "user_not_found" } },
  };
}

function notesIn(): string[] {
  return calls.flatMap((c) => [
    ...c.notes,
    ...c.items.map((i) => `${String(i.name ?? "")}`),
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

describe("runAuthTenantList — happy + error", () => {
  it("resolves email → user_id then GETs memberships", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(userLookupOk())
      .mockResolvedValueOnce({
        status: 200,
        body: {
          memberships: [
            {
              tenant_id: TENANT_ID,
              tenant_name: "T1",
              role: "member",
              is_default: true,
              status: "active",
              created_at: "2026",
              updated_at: "2026",
            },
          ],
        },
      });

    await runAuthTenantList(
      mockConfig,
      { emailOrUsername: EMAIL },
      { kubectlRaw: raw },
    );

    const [, p1, m1, b1] = raw.mock.calls[0] as [
      string,
      string,
      string,
      { email?: string; username?: string },
    ];
    expect(p1).toBe("/internal/users/lookup");
    expect(m1).toBe("POST");
    expect(b1.email).toBe(EMAIL);
    expect(b1.username).toBeUndefined();
    const [, p2] = raw.mock.calls[1] as [string, string];
    expect(p2).toBe(`/admin/users/${USER_ID}/memberships`);
    expect(notesIn().some((s) => s.includes("T1"))).toBe(true);
  });

  it("reports 'no user matched' when lookup returns 404", async () => {
    const raw = vi.fn().mockResolvedValueOnce(userLookupNotFound());
    await expect(
      runAuthTenantList(
        mockConfig,
        { emailOrUsername: "ghost@example.com" },
        { kubectlRaw: raw },
      ),
    ).rejects.toThrow(/No user matched/);
  });

  it("treats input without '@' as a username in the lookup request", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(userLookupOk())
      .mockResolvedValueOnce({ status: 200, body: { memberships: [] } });
    await runAuthTenantList(
      mockConfig,
      { emailOrUsername: "alice" },
      { kubectlRaw: raw },
    );
    const [, , , b1] = raw.mock.calls[0] as [
      string,
      string,
      string,
      { email?: string; username?: string },
    ];
    expect(b1.username).toBe("alice");
    expect(b1.email).toBeUndefined();
  });
});

describe("runAuthTenantAdd — happy + 409 + cross-tenant-admin", () => {
  it("POSTs the membership and renders the result", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(userLookupOk())
      .mockResolvedValueOnce({
        status: 201,
        body: {
          tenant_id: TENANT_ID,
          role: "member",
          is_default: false,
          status: "active",
          created_at: "2026",
          updated_at: "2026",
        },
      });
    await runAuthTenantAdd(
      mockConfig,
      {
        emailOrUsername: EMAIL,
        tenantId: TENANT_ID,
        role: "member",
        isDefault: false,
      },
      { kubectlRaw: raw },
    );
    const [, p2, m2, body] = raw.mock.calls[1] as [
      string,
      string,
      string,
      { tenant_id: string; role: string; is_default: boolean },
    ];
    expect(p2).toBe(`/admin/users/${USER_ID}/memberships`);
    expect(m2).toBe("POST");
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.role).toBe("member");
  });

  it("maps 409 membership_exists", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(userLookupOk())
      .mockResolvedValueOnce({
        status: 409,
        body: { detail: { error: "membership_exists" } },
      });
    await expect(
      runAuthTenantAdd(
        mockConfig,
        {
          emailOrUsername: EMAIL,
          tenantId: TENANT_ID,
          role: "member",
          isDefault: false,
        },
        { kubectlRaw: raw },
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it("maps 403 cross_tenant_admin_forbidden", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(userLookupOk())
      .mockResolvedValueOnce({
        status: 403,
        body: { detail: { error: "cross_tenant_admin_forbidden" } },
      });
    await expect(
      runAuthTenantAdd(
        mockConfig,
        {
          emailOrUsername: EMAIL,
          tenantId: TENANT_ID,
          role: "admin",
          isDefault: false,
        },
        { kubectlRaw: raw },
      ),
    ).rejects.toThrow(/admin\/owner/i);
  });
});

describe("runAuthTenantSetDefault — happy + suspended", () => {
  it("PATCHes is_default=true", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(userLookupOk())
      .mockResolvedValueOnce({
        status: 200,
        body: {
          tenant_id: TENANT_ID,
          role: "member",
          is_default: true,
          status: "active",
          created_at: "2026",
          updated_at: "2026",
        },
      });
    await runAuthTenantSetDefault(
      mockConfig,
      { emailOrUsername: EMAIL, tenantId: TENANT_ID },
      { kubectlRaw: raw },
    );
    const [, p2, m2, body] = raw.mock.calls[1] as [
      string,
      string,
      string,
      { is_default: boolean },
    ];
    expect(p2).toBe(`/admin/users/${USER_ID}/memberships/${TENANT_ID}`);
    expect(m2).toBe("PATCH");
    expect(body.is_default).toBe(true);
  });

  it("maps 400 suspended_cannot_set_default", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(userLookupOk())
      .mockResolvedValueOnce({
        status: 400,
        body: { detail: { error: "suspended_cannot_set_default" } },
      });
    await expect(
      runAuthTenantSetDefault(
        mockConfig,
        { emailOrUsername: EMAIL, tenantId: TENANT_ID },
        { kubectlRaw: raw },
      ),
    ).rejects.toThrow(/suspended/i);
  });
});

describe("runAuthTenantRemove — happy + default invariant", () => {
  it("DELETEs the membership", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(userLookupOk())
      .mockResolvedValueOnce({ status: 204, body: null });
    await runAuthTenantRemove(
      mockConfig,
      { emailOrUsername: EMAIL, tenantId: TENANT_ID },
      { kubectlRaw: raw },
    );
    const [, p2, m2] = raw.mock.calls[1] as [string, string, string];
    expect(p2).toBe(`/admin/users/${USER_ID}/memberships/${TENANT_ID}`);
    expect(m2).toBe("DELETE");
  });

  it("maps 409 would_violate_default_invariant", async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(userLookupOk())
      .mockResolvedValueOnce({
        status: 409,
        body: {
          detail: {
            error: "would_violate_default_invariant",
            hint: "Add a replacement first.",
          },
        },
      });
    await expect(
      runAuthTenantRemove(
        mockConfig,
        { emailOrUsername: EMAIL, tenantId: TENANT_ID },
        { kubectlRaw: raw },
      ),
    ).rejects.toThrow(/default membership/);
  });
});
