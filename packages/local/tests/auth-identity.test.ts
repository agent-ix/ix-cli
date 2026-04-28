/**
 * Unit tests for the auth-identity transport helpers.
 *
 * kubectlExecJson — the only mechanism for admin-mutating operations.
 * kubectlRaw      — kubeconfig-gated K8s API server proxy for non-admin ops.
 *
 * See ix-cli/spec/functional/local/auth.md and auth/ADR-004.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa");

import { execa } from "execa";

import {
  IX_APPS_NAMESPACE,
  IX_AUTH_NAMESPACE,
  IX_PLATFORM_NAMESPACE,
  IX_SYSTEM_NAMESPACE,
  KubectlExecError,
  identityServicePath,
  kubectlExecJson,
  kubectlRaw,
} from "../src/commands/auth-identity.js";

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  mockExeca.mockReset();
});

// ---------------------------------------------------------------------------
// Re-exported namespace constants — auth-identity is the canonical import
// edge for the auth command files.
// ---------------------------------------------------------------------------

describe("auth-identity namespace re-exports", () => {
  it("re-exports the four IX_*_NAMESPACE constants from config.ts", () => {
    expect(IX_SYSTEM_NAMESPACE).toBe("system");
    expect(IX_AUTH_NAMESPACE).toBe("auth");
    expect(IX_PLATFORM_NAMESPACE).toBe("platform");
    expect(IX_APPS_NAMESPACE).toBe("apps");
  });
});

// ---------------------------------------------------------------------------
// identityServicePath
// ---------------------------------------------------------------------------

describe("identityServicePath", () => {
  it("returns the request path verbatim when it has a leading slash", () => {
    expect(identityServicePath("/internal/users/invite")).toBe(
      "/internal/users/invite",
    );
  });

  it("prepends a leading slash if the caller omits one", () => {
    expect(identityServicePath("internal/users/reset")).toBe(
      "/internal/users/reset",
    );
  });

  it("preserves nested paths verbatim", () => {
    expect(identityServicePath("/config/public")).toBe("/config/public");
  });
});

// ---------------------------------------------------------------------------
// kubectlExecJson — happy path, error envelope, JSON parse failure.
// ---------------------------------------------------------------------------

describe("kubectlExecJson", () => {
  it("invokes kubectl exec with the deployment selector and parses stdout", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: '{"user_id": "abc", "password": "p"}',
      stderr: "",
    } as never);

    const result = await kubectlExecJson<{ user_id: string; password: string }>(
      IX_AUTH_NAMESPACE,
      "identity",
      ["python", "-m", "identity.cli", "init-admin", "--output", "json"],
    );

    expect(result).toEqual({ user_id: "abc", password: "p" });
    expect(mockExeca).toHaveBeenCalledTimes(1);
    expect(mockExeca).toHaveBeenCalledWith(
      "kubectl",
      [
        "exec",
        "-n",
        "auth",
        "deployment/identity",
        "--",
        "python",
        "-m",
        "identity.cli",
        "init-admin",
        "--output",
        "json",
      ],
      { all: false },
    );
  });

  it("throws KubectlExecError when kubectl exits non-zero, preserving FR-029 stable exit code", async () => {
    const err: Record<string, unknown> = new Error("kubectl exec failed");
    err.shortMessage = "Command failed with exit code 2: kubectl exec ...";
    err.exitCode = 2;
    err.stdout = "";
    err.stderr =
      '{"error": "admin_exists", "detail": "An admin user already exists."}';
    mockExeca.mockRejectedValueOnce(err);

    await expect(
      kubectlExecJson(IX_AUTH_NAMESPACE, "identity", [
        "python",
        "-m",
        "identity.cli",
        "init-admin",
      ]),
    ).rejects.toMatchObject({
      name: "KubectlExecError",
      exitCode: 2,
      stderr: expect.stringContaining("admin_exists"),
    });
  });

  it("throws KubectlExecError when stdout is empty (envelope contract violation)", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "   ",
      stderr: "",
    } as never);

    await expect(
      kubectlExecJson(IX_AUTH_NAMESPACE, "identity", [
        "python",
        "-m",
        "identity.cli",
        "init-admin",
      ]),
    ).rejects.toBeInstanceOf(KubectlExecError);
  });

  it("throws KubectlExecError when stdout is not valid JSON", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "not json at all",
      stderr: "",
    } as never);

    await expect(
      kubectlExecJson(IX_AUTH_NAMESPACE, "identity", [
        "python",
        "-m",
        "identity.cli",
        "init-admin",
      ]),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("normalizes Buffer stdout to a string before parsing", async () => {
    // execa's typed stdout is `string | Uint8Array | unknown[]`. The helper
    // SHALL coerce to string via asString() before JSON.parse.
    mockExeca.mockResolvedValueOnce({
      stdout: Buffer.from('{"user_id": "buf"}', "utf-8"),
      stderr: Buffer.from("", "utf-8"),
    } as never);

    const result = await kubectlExecJson<{ user_id: string }>(
      IX_AUTH_NAMESPACE,
      "identity",
      ["python", "-m", "identity.cli", "init-admin"],
    );
    expect(result).toEqual({ user_id: "buf" });
  });
});

// ---------------------------------------------------------------------------
// kubectlRaw — kubeconfig-gated HTTP via in-pod proxy script.
//
// The helper shells out to `kubectl exec deployment/identity -- python -c
// <inline-urllib-script> METHOD PATH` with the request body piped on stdin.
// The script prints a single JSON envelope `{status, body}` on stdout.
// ---------------------------------------------------------------------------

describe("kubectlRaw", () => {
  it("invokes kubectl exec with the inline proxy script for POST and parses the envelope", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: '{"status": 201, "body": {"user_id": "u1"}}',
      stderr: "",
    } as never);

    const { status, body } = await kubectlRaw<{ user_id: string }>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/internal/users/invite"),
      "POST",
      { email: "alice@example.com" },
    );

    expect(status).toBe(201);
    expect(body.user_id).toBe("u1");
    const [cmd, args, opts] = mockExeca.mock.calls[0];
    expect(cmd).toBe("kubectl");
    // exec into identity in the auth namespace via python -c <script> METHOD PATH
    expect(args.slice(0, 6)).toEqual([
      "exec",
      "-i",
      "-n",
      "auth",
      "deployment/identity",
      "--",
    ]);
    expect(args[6]).toBe("python");
    expect(args[7]).toBe("-c");
    // The trailing positional args carry method + path.
    expect(args[args.length - 2]).toBe("POST");
    expect(args[args.length - 1]).toBe("/internal/users/invite");
    expect(opts).toMatchObject({
      input: JSON.stringify({ email: "alice@example.com" }),
      all: false,
    });
  });

  it("uses GET method for read endpoints and forwards an empty body via stdin", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout:
        '{"status": 200, "body": {"registration": {"mode": "invite_only"}}}',
      stderr: "",
    } as never);

    const { status, body } = await kubectlRaw<{
      registration: { mode: string };
    }>(IX_AUTH_NAMESPACE, identityServicePath("/config/public"), "GET");

    expect(status).toBe(200);
    expect(body.registration.mode).toBe("invite_only");
    const [, args, opts] = mockExeca.mock.calls[0];
    expect(args[args.length - 2]).toBe("GET");
    expect(args[args.length - 1]).toBe("/config/public");
    expect(opts).toMatchObject({ input: "" });
  });

  it("returns the structured envelope verbatim for HTTP errors (403, 404, etc.)", async () => {
    // identity's HTTPException is wrapped under `detail` by FastAPI; the
    // proxy script JSON-decodes the body and forwards it under `body`.
    mockExeca.mockResolvedValueOnce({
      stdout:
        '{"status": 403, "body": {"detail": {"error": "cannot_reset_admin_via_api", "detail": "use kubectl exec"}}}',
      stderr: "",
    } as never);

    const { status, body } = await kubectlRaw<{
      detail: { error: string };
    }>(
      IX_AUTH_NAMESPACE,
      identityServicePath("/internal/users/reset"),
      "POST",
      { email_or_username: "admin@example" },
    );
    expect(status).toBe(403);
    expect(body.detail.error).toBe("cannot_reset_admin_via_api");
  });

  it("throws when kubectl exec fails (transport-level failure)", async () => {
    const err: Record<string, unknown> = new Error("connection refused");
    err.shortMessage = "Command failed";
    err.exitCode = 1;
    err.stdout = "";
    err.stderr = "The connection to the server was refused.";
    mockExeca.mockRejectedValueOnce(err);

    await expect(
      kubectlRaw(
        IX_AUTH_NAMESPACE,
        identityServicePath("/internal/users/invite"),
        "POST",
        {},
      ),
    ).rejects.toThrow(/kubectl exec → identity HTTP failed/);
  });
});
