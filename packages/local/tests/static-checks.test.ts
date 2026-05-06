import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_SRC = resolve(fileURLToPath(import.meta.url), "../../src");
const PKG_ROOT = resolve(PKG_SRC, "..");

function readSrc(rel: string): string {
  const direct = join(PKG_SRC, rel);
  try {
    return readFileSync(direct, "utf-8");
  } catch {
    // Files were renamed .ts → .tsx during the Ink migration; tolerate either.
    if (rel.endsWith(".ts")) {
      return readFileSync(`${direct}x`, "utf-8");
    }
    throw new Error(`readSrc: file not found: ${direct}`);
  }
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
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
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
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx"))
          continue;
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
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx"))
          continue;
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
    const hits = grepSrc(/import[\s\S]{0,160}\bPhaseTable\b/);
    for (const file of hits) {
      const src = readFileSync(file, "utf-8");
      expect(
        src,
        `${file} should import PhaseTable from @agent-ix/ix-ui-cli`,
      ).toMatch(
        /import[\s\S]{0,160}\bPhaseTable\b[\s\S]{0,160}from\s+["']@agent-ix\/ix-ui-cli["']/,
      );
    }
  });
});

describe("Ink React singleton wiring", () => {
  it("live-hook components import hooks from @agent-ix/ix-ui-cli, not react", () => {
    const files = [
      "local-secrets.ts",
      "credentials.ts",
      "commands/cluster-down.ts",
      "phase-table-runner.ts",
    ];

    for (const file of files) {
      const src = readSrc(file);
      expect(
        src,
        `${file} must not import runtime hooks from react`,
      ).not.toMatch(
        /import\s+(?:React,\s*)?\{[^}]*\buse(?:Effect|State)\b[^}]*\}\s+from\s+["']react["']/,
      );
      expect(
        src,
        `${file} must import live hooks from @agent-ix/ix-ui-cli`,
      ).toMatch(
        /from\s+["']@agent-ix\/ix-ui-cli["'][\s\S]*?\buseEffect\b[\s\S]*?\buseState\b|import\s+\{[\s\S]*?\buseEffect\b[\s\S]*?\buseState\b[\s\S]*?\}\s+from\s+["']@agent-ix\/ix-ui-cli["']/,
      );
    }
  });

  it("local build keeps react external so command chunks do not bundle a second hook dispatcher", () => {
    const src = readFileSync(join(PKG_ROOT, "vite.config.ts"), "utf-8");
    expect(src).toMatch(/\/\^react\(\$\|\\\/\)\//);
  });
});

describe("Ink rendering stays separated from image-mode orchestration", () => {
  it("image mode delegates live rendering to the shared phase-table runner", () => {
    const src = readSrc("commands/up-image.ts");
    const controller = readSrc("up-image-controller.ts");

    expect(src).toMatch(
      /renderPhaseTableRun<[\s\S]*?Phase[\s\S]*?ImageInstallPipelineResult/,
    );
    expect(controller).toMatch(/export async function runAppInstallPipeline/);
    expect(src).not.toMatch(/const AppPhaseTable/);
  });

  it("TC-282: image command wrapper does not own Helm or Kubernetes orchestration", () => {
    const src = readSrc("commands/up-image.ts");

    expect(src).not.toMatch(/\bexeca\(/);
    expect(src).not.toMatch(/\bwaitForRollout\(/);
    expect(src).not.toMatch(/\bensureGhcrCredsInNamespace\(/);
    expect(src).not.toMatch(/\bloadSecretContractFromTgz\(/);
  });

  it("the shared phase-table runner owns Ink lifecycle but no Helm/Kubernetes process work", () => {
    const src = readSrc("phase-table-runner.ts");

    expect(src).toMatch(/<PhaseTable<P>/);
    expect(src).toMatch(
      /controller\(\(snapshot\) => setServices\(snapshot\)\)/,
    );
    expect(src).not.toMatch(/\bexeca\(/);
    expect(src).not.toMatch(/\bwaitForRollout\(/);
    expect(src).not.toMatch(/\bkubectl\b/);
    expect(src).not.toMatch(/\bhelm\b/);
  });
});

describe("Source and image mode share the live PhaseTable renderer", () => {
  it("source mode renders via renderPhaseTableRun instead of final-state Listing", () => {
    const src = readSrc("commands/up-source.ts");

    expect(src).toMatch(/renderPhaseTableRun<SourcePhase,\s*SourceModeResult>/);
    expect(src).toMatch(/phases:\s*SOURCE_PHASES/);
    expect(src).toMatch(/phaseLabels:\s*SOURCE_PHASE_LABELS/);
    expect(src).not.toMatch(/renderStatic\(/);
    expect(src).not.toMatch(/<Listing/);
  });

  it("TC-283: source command wrapper delegates process orchestration to the controller", () => {
    const src = readSrc("commands/up-source.ts");
    const controller = readSrc("up-source-controller.ts");

    expect(src).not.toMatch(/\bexeca\(/);
    expect(src).not.toMatch(/\bwaitForRollout\(/);
    expect(src).not.toMatch(/\bmkdtempSync\(/);
    expect(src).not.toMatch(/\brmSync\(/);
    expect(controller).toMatch(/export async function runSourceModePipeline/);
  });

  it("TC-284: init-cluster command wrapper delegates process orchestration to the controller", () => {
    const src = readSrc("commands/init-cluster.ts");
    const controller = readSrc("init-cluster-controller.ts");

    expect(src).toMatch(/renderPhaseTableRun<InitPhase,\s*InitClusterResult>/);
    expect(src).not.toMatch(/\bexeca\(/);
    expect(src).not.toMatch(/\buseEffect\b/);
    expect(src).not.toMatch(/\buseState\b/);
    expect(controller).toMatch(
      /export async function runInitClusterController/,
    );
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
    const src = readSrc("up-source-controller.ts");
    expect(src).toMatch(/refresh\?:\s*boolean/);
  });

  it("TC-092: runSourceModeUp forces dependencyUpdate=true when refresh is set", () => {
    const src = readSrc("up-source-controller.ts");
    expect(src).toMatch(/opts\.refresh[\s\S]*?dependencyUpdate:\s*true/);
  });

  it("TC-092a: source mode prefers chart-local secret contracts", () => {
    const src = readSrc("up-source-controller.ts");
    expect(src).toMatch(/secretContractDir/);
    expect(src).toMatch(
      /path\.join\(chartPath,\s*SECRETS_FILENAME\)[\s\S]*?return chartPath/,
    );
    expect(src).toMatch(/install\.secretContractDir/);
  });
});

// ---------------------------------------------------------------------------
// FR-034: ix local refresh emits per-chart diff rows via Listing.item
// TC-300 through TC-302
// ---------------------------------------------------------------------------
describe("FR-034: ix local refresh diff output", () => {
  it("TC-300: runRefresh snapshots prior cache before refreshing", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(
      /readCachedDeployables\(config\.org\)[\s\S]*?loadRegistry\(\{[\s\S]*?refresh:\s*true/,
    );
  });

  it("TC-301: runRefresh emits diff rows via <Item> children", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(
      /diffRegistry\(prior,\s*reg\)[\s\S]*?<Item[\s\S]*?formatRefreshChange/,
    );
  });

  it("TC-302: refresh-diff format module is the single source of row text", () => {
    const src = readSrc("refresh-diff.ts");
    expect(src).toMatch(/\(new\)\s*\$\{c\.newVersion\}/);
    expect(src).toMatch(/\$\{c\.oldVersion\}\s*->\s*\$\{c\.newVersion\}/);
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
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/buildUmbrellaInstallArgs/);
    // Per-subchart helm install helper is gone — replaced by the umbrella path.
    expect(src).not.toMatch(/buildHelmLocalInstallArgs/);
  });

  it("TC-094: umbrella path issues `helm pull` against the app OCI ref, not per-subchart", () => {
    const src = readSrc("up-image-controller.ts");
    // Only one helm pull call inside runImageModeUp's app branch — it pulls
    // the umbrella, not each child.
    expect(src).toMatch(/helm[\s\S]{0,50}"pull"[\s\S]{0,200}umbrellaRef/);
  });

  it("TC-095: rollout status appends settling marker when ready but not reconciled", () => {
    const src = readSrc("rollout.ts");
    expect(src).toMatch(/settling/);
    // Suffix marker and human label are appended to the count when settling.
    expect(src).toMatch(/`\$\{base\}·settle`/);
    expect(src).toMatch(/updatedReplicas/);
  });

  it("TC-096: runDown uninstalls the umbrella release first for role=app", () => {
    const src = readSrc("index.ts");
    // Umbrella release name added BEFORE expanding subcharts.
    expect(src).toMatch(
      /role === "app"[\s\S]*?pushRelease\(deployable\.name[\s\S]*?defaultExpandApp/,
    );
  });

  it("TC-097: runDown deduplicates releases via a seen set", () => {
    const src = readSrc("index.ts");
    expect(src).toMatch(/seen\s*=\s*new Set/);
    expect(src).toMatch(/pushRelease/);
  });
});

// ---------------------------------------------------------------------------
// FR-032: ensureGhcrCredsInNamespace runs before helm install in image mode
// so the kubelet can pull images from ghcr.io without manual setup.
// TC-098 through TC-099
// ---------------------------------------------------------------------------
describe("FR-032: ghcr-creds auto-applied to install namespaces", () => {
  it("TC-098: local-secrets exports ensureGhcrCredsInNamespace producing dockerconfigjson Secret", () => {
    const src = readSrc("local-secrets.ts");
    expect(src).toMatch(/export async function ensureGhcrCredsInNamespace/);
    expect(src).toMatch(/kubernetes\.io\/dockerconfigjson/);
    expect(src).toMatch(/ghcr\.io/);
  });

  it("TC-099: runImageModeUp calls ensureGhcrCredsInNamespace for every install namespace before helm install", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/ensureGhcrCredsInNamespace/);
    expect(src).toMatch(
      /resolveGhcrToken[\s\S]*?ensureGhcrCredsInNamespace[\s\S]*?authenticateHelmRegistry/,
    );
  });
});

// ---------------------------------------------------------------------------
// FR-033: Image-mode secrets contract loaded from published chart tgz.
// Secrets are read from the pulled chart, not from a local devDir checkout.
// TC-100 through TC-104
// ---------------------------------------------------------------------------
describe("FR-033: image-mode secrets contract from published chart", () => {
  it("TC-100: local-secrets exports loadSecretContractFromTgz", () => {
    const src = readSrc("local-secrets.ts");
    expect(src).toMatch(/export async function loadSecretContractFromTgz/);
  });

  it("TC-101: up-image.ts does not call findSecretContractDir", () => {
    const src = readSrc("commands/up-image.ts");
    expect(src).not.toMatch(/findSecretContractDir/);
  });

  it("TC-102: runImageModeUp does not accept a devDir parameter", () => {
    const src = readSrc("commands/up-image.ts");
    // The function signature must not include devDir
    expect(src).not.toMatch(/runImageModeUp[\s\S]{0,200}devDir/);
  });

  it("TC-103: app display uses child service rows with pull → secrets → install → ready", () => {
    const src = readSrc("commands/up-image.ts");
    const controller = readSrc("up-image-controller.ts");
    const runner = readSrc("phase-table-runner.ts");
    const phases = readSrc("phases.ts");
    expect(phases).toMatch(/\["pull", "secrets", "install", "ready"\]/);
    // Declarative shared renderer receives PHASES/PHASE_LABELS from image mode.
    expect(src).toMatch(/renderPhaseTableRun<Phase/);
    expect(src).toMatch(/phases:\s*PHASES/);
    expect(src).toMatch(/phaseLabels:\s*PHASE_LABELS/);
    expect(runner).toMatch(/<PhaseTable<P>/);
    expect(controller).not.toMatch(/const APP_ROW/);
    expect(controller).not.toMatch(/\[APP_ROW,/);
    expect(controller).not.toMatch(/hidePendingRows:\s*true/);
  });

  it("TC-104: up-image.ts imports loadSecretContractFromTgz from local-secrets", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/loadSecretContractFromTgz/);
  });

  it("TC-108: single-service image mode pulls the chart tgz before helm install", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(
      /runSingleServicePipeline[\s\S]*?"pull"[\s\S]*?loadSecretContractFromTgz[\s\S]*?buildHelmInstallArgs/,
    );
  });

  it("TC-274: up-image.ts supports bundled subcharts as directories as well as tgzs", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/path\.join\(chartsDir, install\.name\)/);
    expect(src).toMatch(/f\.endsWith\("\.tgz"\)/);
  });

  it("TC-275: up-image.ts imports loadSecretContract for bundled subchart directories", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/loadSecretContract,/);
    expect(src).toMatch(/loadSecretContract\(directoryPath\)/);
  });

  it("TC-276: app umbrella install polls hook status and aborts helm on hook failure", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/detectHelmHookStatuses/);
    expect(src).toMatch(/subprocess\.kill\(\)/);
    expect(src).toMatch(/hook .* failed:/);
  });

  it("TC-277: fatal umbrella pull/install failures throw instead of returning successfully", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/App '\$\{deployable\.name\}' failed/);
    expect(src).not.toMatch(/return;\s*\/\/ umbrella pull failure is fatal/);
    expect(src).not.toMatch(
      /failures\.push\(`\$\{APP_ROW\}: \$\{failureMsg\}`\);\s*return;/,
    );
  });

  it("TC-278: umbrella install cleans up failed Helm hook jobs before retry", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/cleanupFailedHelmHookJobs/);
    expect(src).toMatch(
      /cleanupFailedHelmHookJobs\(umbrellaNamespace, deployable\.name\)[\s\S]*?buildUmbrellaInstallArgs/,
    );
  });

  it("TC-279: image mode forces image pulls when deploying latest tags", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/function shouldForceImagePull/);
    expect(src).toMatch(/ix-service\.image\.pullPolicy=Always/);
    expect(src).toMatch(
      /\$\{child\.name\}\.ix-service\.image\.pullPolicy=Always/,
    );
  });

  it("TC-280: umbrella hook status is not applied to every child row", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).not.toMatch(
      /installs\.forEach\(\(i\) => display\.transition\(i\.name, "install", "running"\)\)/,
    );
    expect(src).not.toMatch(
      /installs\.forEach\(\(i\) => display\.transition\(i\.name, "install", "failed"\)\)/,
    );
    expect(src).toMatch(/findInstallForHookJob\(installs, status\.jobName\)/);
    expect(src).toMatch(/detectHelmHookStatuses/);
    expect(src).toMatch(/AppInstallRows/);
    expect(src).toMatch(/appRows\.updateHook\(install\.name, status\)/);
  });

  it("TC-280b: app install polls Kubernetes readiness during Helm install", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/getRolloutReadyStatus/);
    expect(src).toMatch(/appRows\.updateK8sInstallStatus/);
    expect(src).toMatch(/reconcileActiveInstallHooks/);
  });

  it("TC-280a: late Helm job failures are routed to the matching child row", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(/parseHookFailureMessage/);
    expect(src).toMatch(/\\bjob\\s\+\(\\S\+\)\\s\+failed:/);
    // Format-tolerant: prettier may split the call over multiple lines.
    expect(src).toMatch(
      /findInstallForHookJob\(\s*installs\s*,\s*hookFailure\.jobName\s*,?\s*\)/,
    );
    expect(src).toMatch(/appRows\.failInstall\(/);
  });

  it("TC-280c: unmatched umbrella failures force an overall failed final table", () => {
    const src = readSrc("commands/up-image.ts");
    // The unmatched-failure path captures the message in finalDisplayError, then
    // the React component drives the table into status="failed" with that
    // message as the tail.
    expect(src).toMatch(/finalDisplayError/);
    expect(src).toMatch(/status:\s*"failed"/);
    // Unmatched failures end with finalDisplayError carried into the final tail.
    expect(src).toMatch(/finalDisplayError\s*\?\?\s*err\.message/);
  });

  it("TC-281: secret apply output is not written into service status rows", () => {
    const src = readSrc("up-image-controller.ts");
    expect(src).toMatch(
      /await applySecretContract\(contract, install\.namespace\);/,
    );
    expect(src).not.toMatch(/display\.setPodStatus\(install\.name, line\)/);
  });
});
