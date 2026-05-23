/**
 * FR-044 — `ix local auth kubeconfig issue` unit tests.
 *
 * Covers AC-1..AC-9 and CON-1/3/4. Live cluster never required: every kubectl
 * shell-out is replaced by an injected dep.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeListingMock, type ListingMockBag } from "./listing-helpers.js";

vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());

import * as ui from "@agent-ix/ix-ui-cli";
import {
  runAuthKubeconfigIssue,
  KubeconfigIssueError,
  decodeTokenB64,
  type AuthKubeconfigIssueDeps,
  type ClusterBlock,
} from "../src/commands/auth-kubeconfig.js";
import { parse as parseYaml } from "yaml";

const calls = (ui as unknown as ListingMockBag).__calls;
const resetListings = (ui as unknown as ListingMockBag).__reset;

const mockConfig = { internalBaseDomain: "dev.ix" } as never;

// A distinctive sentinel that AC-6 / CON-3 assertions grep for.
const TOKEN_SENTINEL = "TESTTOKEN-SHOULD-NOT-LEAK";
const TOKEN_B64 = Buffer.from(TOKEN_SENTINEL, "utf-8").toString("base64");

const CLUSTER: ClusterBlock = {
  server: "https://kubernetes.example:6443",
  "certificate-authority-data": "Q0EtREFUQQ==",
};

function notesIn(): string[] {
  return calls.flatMap((c) => [
    ...c.notes,
    ...c.infos.map(
      (i) => `${String(i.name ?? "")} ${String(i.description ?? "")}`,
    ),
    ...(typeof c.tail === "string" ? [c.tail] : []),
  ]);
}

interface FsRecorder {
  writes: { path: string; data: string; mode?: number }[];
  renames: { from: string; to: string }[];
  chmods: { path: string; mode: number }[];
  unlinks: string[];
  existing: Set<string>;
}

function makeDeps(
  overrides: {
    configView?: AuthKubeconfigIssueDeps["kubectlConfigView"];
    getSecret?: AuthKubeconfigIssueDeps["kubectlGetSecret"];
    existing?: string[];
  } = {},
): {
  deps: AuthKubeconfigIssueDeps;
  recorder: FsRecorder;
  configViewSpy: ReturnType<typeof vi.fn>;
  getSecretSpy: ReturnType<typeof vi.fn>;
} {
  const recorder: FsRecorder = {
    writes: [],
    renames: [],
    chmods: [],
    unlinks: [],
    existing: new Set(overrides.existing ?? []),
  };

  const configViewSpy = vi.fn(
    overrides.configView ??
      (async () => ({ name: "kind-platform", cluster: CLUSTER })),
  );
  const getSecretSpy = vi.fn(
    overrides.getSecret ?? (async () => ({ tokenB64: TOKEN_B64 })),
  );

  const deps: AuthKubeconfigIssueDeps = {
    kubectlConfigView: configViewSpy,
    kubectlGetSecret: getSecretSpy,
    pathExists: async (p) => recorder.existing.has(p),
    writeFile: async (p, data, opts) => {
      recorder.writes.push({ path: p, data, mode: opts?.mode });
      recorder.existing.add(p);
    },
    rename: async (from, to) => {
      recorder.renames.push({ from, to });
      recorder.existing.delete(from);
      recorder.existing.add(to);
    },
    chmod: async (p, mode) => {
      recorder.chmods.push({ path: p, mode });
    },
    unlink: async (p) => {
      recorder.unlinks.push(p);
      recorder.existing.delete(p);
    },
  };

  return { deps, recorder, configViewSpy, getSecretSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetListings();
});

describe("runAuthKubeconfigIssue — AC-1 happy path", () => {
  it("writes a kubeconfig and exits 0", async () => {
    const { deps, recorder } = makeDeps();

    await runAuthKubeconfigIssue(
      mockConfig,
      {
        outputPath: "/tmp/ix-local.yaml",
        contextName: "ix-local",
        force: false,
      },
      deps,
    );

    // tempfile written then renamed to the final path
    expect(recorder.writes).toHaveLength(1);
    expect(recorder.renames).toHaveLength(1);
    expect(recorder.renames[0].to).toBe("/tmp/ix-local.yaml");
    expect(recorder.renames[0].from).toBe(recorder.writes[0].path);
    expect(recorder.writes[0].path).not.toBe("/tmp/ix-local.yaml");
  });
});

describe("runAuthKubeconfigIssue — AC-2/AC-7/AC-8 emitted YAML shape", () => {
  it("emits a parseable kubeconfig with the expected blocks", async () => {
    const { deps, recorder } = makeDeps();

    await runAuthKubeconfigIssue(
      mockConfig,
      {
        outputPath: "/tmp/ix-local.yaml",
        contextName: "ix-local",
        force: false,
      },
      deps,
    );

    const yamlText = recorder.writes[0].data;
    const parsed = parseYaml(yamlText) as {
      apiVersion: string;
      kind: string;
      clusters: { name: string; cluster: ClusterBlock }[];
      users: { name: string; user: { token: string } }[];
      contexts: {
        name: string;
        context: { cluster: string; user: string };
      }[];
      "current-context": string;
    };

    expect(parsed.apiVersion).toBe("v1");
    expect(parsed.kind).toBe("Config");
    // AC-8: cluster block is a verbatim copy of the source.
    expect(parsed.clusters[0].cluster.server).toBe(CLUSTER.server);
    expect(parsed.clusters[0].cluster["certificate-authority-data"]).toBe(
      CLUSTER["certificate-authority-data"],
    );
    expect(parsed.users[0].name).toBe("ix-cli-admin");
    expect(parsed.users[0].user.token).toBe(TOKEN_SENTINEL);
    expect(parsed.contexts[0].name).toBe("ix-local");
    expect(parsed.contexts[0].context.user).toBe("ix-cli-admin");
    expect(parsed["current-context"]).toBe("ix-local");
  });

  it("AC-7: --context-name custom value lands in current-context", async () => {
    const { deps, recorder } = makeDeps();

    await runAuthKubeconfigIssue(
      mockConfig,
      { outputPath: "/tmp/ix-local.yaml", contextName: "foo", force: false },
      deps,
    );

    const parsed = parseYaml(recorder.writes[0].data) as {
      contexts: { name: string }[];
      "current-context": string;
    };
    expect(parsed.contexts[0].name).toBe("foo");
    expect(parsed["current-context"]).toBe("foo");
  });
});

describe("runAuthKubeconfigIssue — AC-3 file mode 0600", () => {
  it("writes the tempfile with mode 0600 and explicitly chmods it", async () => {
    const { deps, recorder } = makeDeps();

    await runAuthKubeconfigIssue(
      mockConfig,
      {
        outputPath: "/tmp/ix-local.yaml",
        contextName: "ix-local",
        force: false,
      },
      deps,
    );

    expect(recorder.writes[0].mode).toBe(0o600);
    expect(recorder.chmods).toHaveLength(1);
    expect(recorder.chmods[0].mode).toBe(0o600);
    // Chmod targets the tempfile (atomic write — rename happens after).
    expect(recorder.chmods[0].path).toBe(recorder.writes[0].path);
  });
});

describe("runAuthKubeconfigIssue — AC-4 missing Secret", () => {
  it("surfaces a clear error and writes nothing when the Secret is missing", async () => {
    const { deps, recorder } = makeDeps({
      getSecret: async () => {
        throw new KubeconfigIssueError(
          "secret_not_found",
          "ix-cli admin ServiceAccount token Secret is missing.",
        );
      },
    });

    await expect(
      runAuthKubeconfigIssue(
        mockConfig,
        {
          outputPath: "/tmp/ix-local.yaml",
          contextName: "ix-local",
          force: false,
        },
        deps,
      ),
    ).rejects.toThrow(/missing/i);

    // CON-4 fail-closed: nothing on disk.
    expect(recorder.writes).toHaveLength(0);
    expect(recorder.renames).toHaveLength(0);
  });
});

describe("runAuthKubeconfigIssue — AC-5 existing file + --force", () => {
  it("refuses to overwrite without --force", async () => {
    const { deps, recorder } = makeDeps({
      existing: ["/tmp/ix-local.yaml"],
    });

    await expect(
      runAuthKubeconfigIssue(
        mockConfig,
        {
          outputPath: "/tmp/ix-local.yaml",
          contextName: "ix-local",
          force: false,
        },
        deps,
      ),
    ).rejects.toThrow(/Refusing to overwrite/i);

    expect(recorder.writes).toHaveLength(0);
  });

  it("overwrites with --force", async () => {
    const { deps, recorder } = makeDeps({
      existing: ["/tmp/ix-local.yaml"],
    });

    await runAuthKubeconfigIssue(
      mockConfig,
      {
        outputPath: "/tmp/ix-local.yaml",
        contextName: "ix-local",
        force: true,
      },
      deps,
    );

    expect(recorder.writes).toHaveLength(1);
    expect(recorder.renames[0].to).toBe("/tmp/ix-local.yaml");
  });
});

describe("runAuthKubeconfigIssue — AC-6 / CON-3 token never leaks", () => {
  it("token sentinel never appears in any captured output stream", async () => {
    const { deps } = makeDeps();

    // Capture stdout + stderr writes throughout the run.
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
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
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await runAuthKubeconfigIssue(
        mockConfig,
        {
          outputPath: "/tmp/ix-local.yaml",
          contextName: "ix-local",
          force: false,
        },
        deps,
      );
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      logSpy.mockRestore();
      errSpy.mockRestore();
    }

    const combined = [
      ...stdoutChunks,
      ...stderrChunks,
      ...logSpy.mock.calls.flat().map(String),
      ...errSpy.mock.calls.flat().map(String),
      ...notesIn(),
    ].join("\n");
    expect(combined).not.toContain(TOKEN_SENTINEL);
    expect(combined).not.toContain(TOKEN_B64);
  });
});

describe("runAuthKubeconfigIssue — CON-1 no HTTP traffic", () => {
  it("never calls global fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch is forbidden by FR-044-CON-1");
    });
    const { deps } = makeDeps();

    await runAuthKubeconfigIssue(
      mockConfig,
      {
        outputPath: "/tmp/ix-local.yaml",
        contextName: "ix-local",
        force: false,
      },
      deps,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("runAuthKubeconfigIssue — CON-3 token never enters process argv", () => {
  it("emitted kubectl calls never receive the decoded token as an argument", async () => {
    const { deps, configViewSpy, getSecretSpy } = makeDeps();

    await runAuthKubeconfigIssue(
      mockConfig,
      {
        outputPath: "/tmp/ix-local.yaml",
        contextName: "ix-local",
        force: false,
      },
      deps,
    );

    const allArgs = [
      ...configViewSpy.mock.calls.flat(),
      ...getSecretSpy.mock.calls.flat(),
    ].map(String);
    for (const a of allArgs) {
      expect(a).not.toContain(TOKEN_SENTINEL);
      expect(a).not.toContain(TOKEN_B64);
    }
  });
});

describe("buildKubeconfigYaml / decodeTokenB64 — AC-9 invalid base64", () => {
  it("AC-9: invalid base64 produces a clean error", () => {
    expect(() => decodeTokenB64("not_base_64_$$$")).toThrow(/base64/i);
  });

  it("rejects empty token", () => {
    expect(() => decodeTokenB64("")).toThrow(/empty/i);
  });

  it("accepts a valid base64 payload", () => {
    expect(decodeTokenB64(TOKEN_B64)).toBe(TOKEN_SENTINEL);
  });
});

describe("runAuthKubeconfigIssue — AC-9 invalid base64 propagation", () => {
  it("invalid token Secret produces a non-zero exit + no file written", async () => {
    const { deps, recorder } = makeDeps({
      getSecret: async () => ({ tokenB64: "not_base_64_$$$" }),
    });

    await expect(
      runAuthKubeconfigIssue(
        mockConfig,
        {
          outputPath: "/tmp/ix-local.yaml",
          contextName: "ix-local",
          force: false,
        },
        deps,
      ),
    ).rejects.toThrow(/base64/i);
    expect(recorder.writes).toHaveLength(0);
    expect(recorder.renames).toHaveLength(0);
  });
});
