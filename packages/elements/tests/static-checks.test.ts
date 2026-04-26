/**
 * TC-044–TC-050: Static source compliance checks
 * NFR-001 (output via ix-ui-cli), FR-010-AC-5 (no console.log in command handlers)
 */

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
// TC-044–TC-047: FR-010/011/012 — index.ts exports all runner functions
// ---------------------------------------------------------------------------
describe("index.ts runner exports", () => {
  it("TC-044: exports runElementsList", () => {
    expect(readSrc("index.ts")).toMatch(/runElementsList/);
  });

  it("TC-045: exports runInit", () => {
    expect(readSrc("index.ts")).toMatch(/runInit/);
  });

  it("TC-046: exports runElementsNew", () => {
    expect(readSrc("index.ts")).toMatch(/runElementsNew/);
  });

  it("TC-047: exports runTapAdd, runTapRemove, runTapList", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/runTapAdd/);
    expect(src).toMatch(/runTapRemove/);
    expect(src).toMatch(/runTapList/);
  });
});

// ---------------------------------------------------------------------------
// TC-048: NFR-001-AC-1 / FR-010-AC-5 — no console.log in src
// ---------------------------------------------------------------------------
describe("NFR-001-AC-1: no console.* in src", () => {
  it("TC-048: src contains no console.log|error|warn|info calls", () => {
    const hits = grepSrc(/console\.(log|error|warn|info)\(/);
    expect(hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-049: NFR-001-AC-1 — no process.stderr.write in src
// ---------------------------------------------------------------------------
describe("NFR-001-AC-1: no stderr.write in src", () => {
  it("TC-049: src contains no process.stderr.write calls", () => {
    const hits = grepSrc(/process\.stderr\.write/);
    expect(hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-050: NFR-001-AC-2 — introCommand imported from @agent-ix/ix-ui-cli
// ---------------------------------------------------------------------------
describe("NFR-001-AC-2: ix-ui-cli used for intro/outro", () => {
  it("TC-050: every command file that calls introCommand imports from @agent-ix/ix-ui-cli", () => {
    const cmdDir = join(PKG_SRC, "commands");
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const src = readFileSync(full, "utf-8");
        if (/introCommand\(/.test(src)) {
          expect(
            src,
            `${entry.name} should import introCommand from @agent-ix/ix-ui-cli`,
          ).toContain("@agent-ix/ix-ui-cli");
        }
      }
    };
    walk(cmdDir);
  });
});
