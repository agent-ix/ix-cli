import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_SRC = resolve(fileURLToPath(import.meta.url), "../../src");

function readSrc(rel: string): string {
  const direct = join(PKG_SRC, rel);
  try {
    return readFileSync(direct, "utf-8");
  } catch {
    if (rel.endsWith(".ts")) return readFileSync(`${direct}x`, "utf-8");
    throw new Error(`readSrc: file not found: ${direct}`);
  }
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTs(full, out);
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      out.push(full);
  }
  return out;
}

// Strip block + line comments so grep gates ignore docstrings.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Strip strings AND comments so the "no networked transport" check can ignore
// kubectl invocation strings like "http:identity:80/proxy/..." that legitimately
// contain `http:` substrings.
function stripCommentsAndStrings(src: string): string {
  return stripComments(src)
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

// ---------------------------------------------------------------------------
// ix-cli-auth-AC-1 / ix-cli-auth-CON-1 — TC-080 / TC-086
//
// `auth-init.ts` and `auth-reset-admin.ts` SHALL NOT contain any networked
// transport for identity. The only acceptable mechanism is `kubectl exec`
// via `kubectlExecJson` (auth/ADR-004, FR-008-CON-1).
// ---------------------------------------------------------------------------

describe("ix-cli-auth-AC-1 — admin commands have no networked transport", () => {
  const FORBIDDEN = [
    /\bfetch\s*\(/, // global fetch / undici fetch
    /from\s+["']undici["']/,
    /from\s+["']node-fetch["']/,
    /\bresolveIdentityUrl\s*\(/, // legacy port-forward helper
    /\bkubectlRaw\s*\(/, // proxy-based transport — forbidden for admin ops
    /https?:\/\//, // any literal HTTP(S) URL constant
    /--raw\b/, // kubectl --raw flag
    /port-forward/,
  ] as const;

  for (const file of [
    "commands/auth-init.ts",
    "commands/auth-reset-admin.ts",
  ]) {
    it(`${file} contains no networked transport (TC-080/TC-086)`, () => {
      const stripped = stripCommentsAndStrings(readSrc(file));
      const hits = FORBIDDEN.flatMap((re) =>
        stripped.match(re) ? [`${re}: matched`] : [],
      );
      expect(hits).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// ix-cli-auth-AC-6 / ix-cli-auth-CON-4 — TC-085
//
// No string-literal namespaces in src outside config.ts. All namespace use
// SHALL go through the IX_*_NAMESPACE constants exported from config.ts.
// ---------------------------------------------------------------------------

describe("ix-cli-auth-AC-6 — namespace constants are the single source of truth", () => {
  // Forbidden as standalone string literals only — bare words inside identifiers
  // (e.g. `IX_AUTH_NAMESPACE`) and inside comments / string contents are fine
  // because we strip both before scanning.
  const FORBIDDEN = [
    "default",
    "auth",
    "system",
    "platform",
    "apps",
    "ix-system",
  ];

  // Pre-existing sites where namespace string literals are accepted because
  // they are NOT part of the auth-namespace contract:
  //   - local-secrets.ts: per-secret-contract namespace fallback (operator
  //     fills this in via secrets.yaml; the literal is the "no override" case).
  //   - init-cluster.ts: cert-manager + ingress-nginx are out-of-scope
  //     infrastructure that must remain in their pinned upstream namespaces.
  // Any new use of a namespace literal in source SHALL be added to this
  // allowlist explicitly, with rationale, or — preferably — replaced with one
  // of the IX_*_NAMESPACE constants.
  const ALLOWLIST = new Set([
    "src/local-secrets.ts",
    "src/local-secrets.tsx",
    "src/commands/init-cluster.ts",
    "src/commands/init-cluster.tsx",
    "src/rollout.ts", // function-default in JSDoc-only; see below
  ]);

  it("packages/local/src outside config.ts contains no namespace string literals", () => {
    const files = walkTs(PKG_SRC).filter((f) => !f.endsWith("/config.ts"));
    const findings: string[] = [];
    for (const file of files) {
      const rel = file.slice(file.indexOf("src/"));
      if (ALLOWLIST.has(rel)) continue;
      const src = stripComments(readFileSync(file, "utf-8"));
      // Match string-literals: "default", 'default', or `default` exactly
      // (the value, not as a substring).
      for (const ns of FORBIDDEN) {
        const patterns = [
          new RegExp(`(?<!\\w)"${ns}"(?!\\w)`),
          new RegExp(`(?<!\\w)'${ns}'(?!\\w)`),
          new RegExp(`(?<!\\w)\`${ns}\`(?!\\w)`),
        ];
        if (patterns.some((p) => p.test(src))) {
          findings.push(`${file}: literal "${ns}"`);
        }
      }
    }
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ix-cli-auth-CON-2 — TC-087 (static)
//
// `auth-secret.ts` writes the admin-bootstrap Secret to IX_SYSTEM_NAMESPACE,
// never IX_AUTH_NAMESPACE or any other.
// ---------------------------------------------------------------------------

describe("ix-cli-auth-CON-2 — bootstrap Secret namespace", () => {
  it("auth-secret.ts imports IX_SYSTEM_NAMESPACE and uses it in the manifest", () => {
    const src = readSrc("commands/auth-secret.ts");
    expect(src).toMatch(/IX_SYSTEM_NAMESPACE/);
    // Must NOT use any other IX_*_NAMESPACE constant for the Secret manifest.
    expect(src).not.toMatch(/IX_AUTH_NAMESPACE/);
    expect(src).not.toMatch(/IX_PLATFORM_NAMESPACE/);
    expect(src).not.toMatch(/IX_APPS_NAMESPACE/);
  });
});

// ---------------------------------------------------------------------------
// ix-cli-auth-CON-3 — TC-088
//
// Every kubectlRaw(...) invocation in auth-*.ts passes IX_AUTH_NAMESPACE
// (or another IX_*_NAMESPACE constant) as the namespace argument.
// ---------------------------------------------------------------------------

describe("ix-cli-auth-CON-3 — kubectlRaw targets the auth namespace", () => {
  const AUTH_FILES = [
    "commands/auth-invite.ts",
    "commands/auth-reset-user.ts",
    "commands/auth-config.ts",
  ];

  for (const file of AUTH_FILES) {
    it(`${file} calls kubectlRaw only with IX_AUTH_NAMESPACE`, () => {
      const src = readSrc(file);
      // Find every call site of `kubectlRaw(` and grab the first argument up to
      // the comma. The arg must be `IX_AUTH_NAMESPACE` (or _raw alias).
      const re = /\b_?(?:raw|kubectlRaw)\s*<[^>]*>\s*\(\s*([^,)]+)\s*,/g;
      const offenders: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = re.exec(src)) !== null) {
        const firstArg = match[1].trim();
        if (
          firstArg !== "IX_AUTH_NAMESPACE" &&
          firstArg !== "namespace" // helper-internal forwarding
        ) {
          offenders.push(`first arg "${firstArg}" at offset ${match.index}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// auth-identity.ts contract — kubectlExecJson and kubectlRaw exports only
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NFR-003 namespace + RBAC bootstrap manifest
// ---------------------------------------------------------------------------

describe("NFR-003 namespace + RBAC bootstrap (init-cluster.ts)", () => {
  const src = readSrc("commands/init-cluster.ts");

  it("creates the four namespaces", () => {
    // Expect a `Namespace` resource for each tier in the manifest string.
    for (const tier of ["system", "auth", "platform", "apps"]) {
      const re = new RegExp(
        `kind:\\s*Namespace[\\s\\S]*?name:\\s*\\$\\{IX_${tier.toUpperCase()}_NAMESPACE\\}`,
      );
      expect(src).toMatch(re);
    }
  });

  it("grants identity SA delete-only RBAC on system/admin-bootstrap", () => {
    expect(src).toMatch(/kind:\s*Role\b/);
    expect(src).toMatch(/resourceNames:\s*\["admin-bootstrap"\]/);
    expect(src).toMatch(/verbs:\s*\["delete"\]/);
    // Negative: no other verbs allowed.
    expect(src).not.toMatch(/verbs:\s*\["get"/);
    expect(src).not.toMatch(/verbs:\s*\["\*"\]/);
    // Bind to identity SA in IX_AUTH_NAMESPACE.
    expect(src).toMatch(/kind:\s*RoleBinding\b/);
    expect(src).toMatch(/name:\s*identity\b/);
    expect(src).toMatch(/namespace:\s*\$\{IX_AUTH_NAMESPACE\}/);
  });

  it("denies all ingress to the system namespace (defense-in-depth)", () => {
    expect(src).toMatch(/kind:\s*NetworkPolicy\b/);
    expect(src).toMatch(/system-deny-all-ingress/);
    expect(src).toMatch(/namespace:\s*\$\{IX_SYSTEM_NAMESPACE\}/);
    expect(src).toMatch(/policyTypes:\s*\n?\s*-\s*Ingress/);
    expect(src).toMatch(/ingress:\s*\[\]/);
  });

  it("registers a 'namespaces + rbac' init step", () => {
    expect(src).toMatch(/"namespaces \+ rbac"/);
  });
});

describe("auth-identity.ts exports the two-helper contract", () => {
  const src = readSrc("commands/auth-identity.ts");

  it("exports kubectlExecJson", () => {
    expect(src).toMatch(/export\s+async\s+function\s+kubectlExecJson\b/);
  });

  it("exports kubectlRaw", () => {
    expect(src).toMatch(/export\s+async\s+function\s+kubectlRaw\b/);
  });

  it("does NOT export resolveIdentityUrl (legacy port-forward helper)", () => {
    expect(src).not.toMatch(
      /export\s+(?:async\s+)?function\s+resolveIdentityUrl\b/,
    );
  });

  it("does NOT export fetchJson (legacy HTTP helper)", () => {
    expect(src).not.toMatch(/export\s+(?:async\s+)?function\s+fetchJson\b/);
  });

  it("re-exports the four namespace constants", () => {
    expect(src).toMatch(/IX_SYSTEM_NAMESPACE/);
    expect(src).toMatch(/IX_AUTH_NAMESPACE/);
    expect(src).toMatch(/IX_PLATFORM_NAMESPACE/);
    expect(src).toMatch(/IX_APPS_NAMESPACE/);
  });
});
