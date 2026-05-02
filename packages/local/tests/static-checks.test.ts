import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_SRC = resolve(fileURLToPath(import.meta.url), "../../src");

function readSrc(rel: string): string {
  return readFileSync(join(PKG_SRC, rel), "utf-8");
}

function grepSrc(pattern: RegExp, dir = PKG_SRC): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const src = readFileSync(full, "utf-8");
      if (pattern.test(src)) hits.push(full);
    }
  };
  walk(dir);
  return hits;
}

// ---------------------------------------------------------------------------
// FR-002-AC-3: no "AppDisplay" anywhere in src
// ---------------------------------------------------------------------------
describe("FR-002-AC-3: no AppDisplay reference", () => {
  it("src contains no AppDisplay import or usage", () => {
    const hits = grepSrc(/AppDisplay/);
    expect(hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FR-002-AC-4: Phase type defined in phases.ts and not duplicated elsewhere
// ---------------------------------------------------------------------------
describe("FR-002-AC-4: Phase type in phases.ts only", () => {
  it("phases.ts exports Phase type", () => {
    const src = readSrc("phases.ts");
    expect(src).toMatch(/export\s+type\s+Phase\b|export\s+\{[^}]*Phase[^}]*\}/);
  });

  it("Phase type is not re-declared outside phases.ts", () => {
    const hits = grepSrc(/type Phase\s*=/);
    // Allow only phases.ts itself
    const outside = hits.filter((f) => !f.endsWith("phases.ts"));
    expect(outside).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// NFR-001-AC-1: no console.log/error/warn/info or stderr.write in src
// ---------------------------------------------------------------------------
describe("NFR-001-AC-1: no console.* or stderr in src", () => {
  it("src contains no console.log|error|warn|info calls", () => {
    const hits = grepSrc(/console\.(log|error|warn|info)\(/);
    expect(hits).toHaveLength(0);
  });

  it("src contains no process.stderr.write calls", () => {
    const hits = grepSrc(/process\.stderr\.write/);
    expect(hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// NFR-001-AC-2: startListing imported from @agent-ix/ix-ui-cli in command files
// ---------------------------------------------------------------------------
describe("NFR-001-AC-2: ix-ui-cli used for command framing", () => {
  const cmdDir = join(PKG_SRC, "commands");

  it("every command file that calls startListing imports it from @agent-ix/ix-ui-cli", () => {
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const src = readFileSync(full, "utf-8");
        if (/startListing\(/.test(src)) {
          expect(
            src,
            `${entry.name} should import startListing from @agent-ix/ix-ui-cli`,
          ).toContain("@agent-ix/ix-ui-cli");
        }
      }
    };
    walk(cmdDir);
  });

  it("no command file uses the deprecated intro/outro API", () => {
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const src = readFileSync(full, "utf-8");
        expect(
          src,
          `${entry.name} should not call deprecated introCommand/outro* helpers`,
        ).not.toMatch(
          /\b(introCommand|outroSuccess|outroError|outroWarning|outroInfo)\(/,
        );
      }
    };
    walk(cmdDir);
  });
});

// ---------------------------------------------------------------------------
// NFR-001-AC-5: no inline ANSI / no inline box-drawing connectors in src
// ---------------------------------------------------------------------------
describe("NFR-001-AC-5: no inline ANSI or connectors", () => {
  it("src contains no inline ANSI escape sequences", () => {
    const hits = grepSrc(/\\x1b\[|\\u001b\[/);
    expect(hits).toHaveLength(0);
  });

  it("src contains no inline box-drawing connectors", () => {
    const hits = grepSrc(/└──┐|└──•|└──/);
    expect(hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// NFR-001-AC-3: PhaseTable imported from @agent-ix/ix-ui-cli (not a local file)
// ---------------------------------------------------------------------------
describe("NFR-001-AC-3: PhaseTable imported from @agent-ix/ix-ui-cli", () => {
  it("PhaseTable is imported from @agent-ix/ix-ui-cli, not a relative path", () => {
    const hits = grepSrc(/import.*PhaseTable/);
    for (const file of hits) {
      const src = readFileSync(file, "utf-8");
      expect(
        src,
        `${file} should import PhaseTable from @agent-ix/ix-ui-cli`,
      ).toMatch(/import.*PhaseTable.*from\s+["']@agent-ix\/ix-ui-cli["']/);
    }
  });
});

// ---------------------------------------------------------------------------
// FR-001-AC-1: core runner functions are exported from index.ts
// TC-001 through TC-006
// ---------------------------------------------------------------------------
describe("FR-001-AC-1: core runner functions are exported", () => {
  it("TC-001: index.ts exports runUp", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(
      /export.*runUp|export function runUp|export async function runUp/,
    );
  });

  it("TC-002: index.ts exports runDown", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(
      /export.*runDown|export function runDown|export async function runDown/,
    );
  });

  it("TC-003: index.ts exports runList", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/export.*runList/);
  });

  it("TC-004: index.ts exports runAuthInit", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/export.*runAuthInit/);
  });

  it("TC-005: index.ts exports runInitCluster", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/export.*runInitCluster/);
  });

  it("TC-006: index.ts exports runAuthResetAdmin, runAuthInvite, runAuthResetUser", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/runAuthResetAdmin/);
    expect(src).toMatch(/runAuthInvite/);
    expect(src).toMatch(/runAuthResetUser/);
  });
});

// ---------------------------------------------------------------------------
// FR-004-AC-1: cluster command exports present in index.ts
// TC-007 through TC-011
// ---------------------------------------------------------------------------
describe("FR-004-AC-1: cluster runner functions are exported", () => {
  it("TC-007: index.ts exports runClusterUp", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/runClusterUp/);
  });

  it("TC-008: index.ts exports computeEffectiveDeploySet", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/computeEffectiveDeploySet/);
  });

  it("TC-009: index.ts exports runClusterDown", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/runClusterDown/);
  });

  it("TC-010: index.ts exports runClusterStatus", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/runClusterStatus/);
  });

  it("TC-011: index.ts exports loadClusterConfig", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/loadClusterConfig/);
  });
});

// ---------------------------------------------------------------------------
// FR-030: --refresh flag plumbed from CLI through runUp into UpFilterOptions
// TC-090 through TC-092
// ---------------------------------------------------------------------------
describe("FR-030: --refresh flag is wired end-to-end", () => {
  it("TC-090: runUp options accept refresh boolean", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/refresh\?:\s*boolean/);
    expect(src).toMatch(/refresh:\s*opts\.refresh/);
  });

  it("TC-091: UpFilterOptions declares refresh", () => {
    const src = readSrc("commands/up-source.ts");
    expect(src).toMatch(/refresh\?:\s*boolean/);
  });

  it("TC-092: runSourceModeUp forces dependencyUpdate=true when refresh is set", () => {
    const src = readSrc("commands/up-source.ts");
    expect(src).toMatch(/opts\.refresh[\s\S]*?dependencyUpdate:\s*true/);
  });
});

// ---------------------------------------------------------------------------
// FR-031: Umbrella install — single helm upgrade per app, parallel rollout
// watchers per subchart drive PhaseTable rows. Settling marker on rollout
// status when pods are Ready but the Deployment hasn't reconciled.
// TC-093 through TC-095
// ---------------------------------------------------------------------------
describe("FR-031: umbrella install + settling indicator", () => {
  it("TC-093: up-image.ts builds umbrella install args (single helm release per app)", () => {
    const src = readSrc("commands/up-image.ts");
    expect(src).toMatch(/buildUmbrellaInstallArgs/);
    // Per-subchart helm install helper is gone — replaced by the umbrella path.
    expect(src).not.toMatch(/buildHelmLocalInstallArgs/);
  });

  it("TC-094: umbrella path issues `helm pull` against the app OCI ref, not per-subchart", () => {
    const src = readSrc("commands/up-image.ts");
    // Only one helm pull call inside runImageModeUp's app branch — it pulls
    // the umbrella, not each child.
    expect(src).toMatch(/helm[\s\S]{0,50}"pull"[\s\S]{0,200}umbrellaRef/);
  });

  it("TC-095: rollout status appends settling marker when ready but not reconciled", () => {
    const src = readSrc("rollout.ts");
    expect(src).toMatch(/settling/);
    // Suffix marker `·` is appended to the count when settling.
    expect(src).toMatch(/`\$\{base\}·`/);
  });
});
