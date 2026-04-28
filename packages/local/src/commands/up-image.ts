/**
 * FR-008 — Image-Mode Deployable Installation
 * FR-013 — Composable App Expansion
 * FR-021 — Concurrent Service Startup with Rate Control
 * FR-022 — App Startup Display
 *
 * For role=service, install one chart as a Helm release via Listr2.
 * For role=app, expand the chart's `dependencies` and run each child
 * pipeline concurrently behind Pool-gated semaphores, displaying progress
 * in the phase-column table (PhaseTable from @agent-ix/ix-ui-cli).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { ListrTaskWrapper } from "listr2";
import pc from "picocolors";
import { parse as parseYaml } from "yaml";
import type { IxConfig } from "../config.js";
import type { Deployable } from "../discovery.js";
import { resolveGhcrToken } from "../credentials.js";
import { buildHelmSetArgs, resolveCatalog } from "../host-mounts.js";
import { waitForRollout, diagnosePodFailure } from "../rollout.js";
import {
  SECRETS_FILENAME,
  loadSecretContract,
  applySecretContract,
  type SecretContract,
} from "../local-secrets.js";
import {
  PhaseTable,
  makeListr,
  startListing,
  type Listing,
} from "@agent-ix/ix-ui-cli";
import type { Phase } from "../phases.js";
import { loadConcurrencyConfig, createPools } from "../pool.js";

const UP_PHASES = [
  "secrets",
  "pull",
  "install",
  "ready",
] as const satisfies readonly Phase[];
const UP_PHASE_LABELS: Partial<Record<Phase, string>> = {
  secrets: "secrets",
  pull: "pulling",
  install: "installing",
  ready: "ready",
};

export interface ChildInstall {
  /** Helm release name == chart name (FR-013-AC-3) */
  name: string;
  /** Full OCI ref including chart name */
  chartRef: string;
  /** Chart version to pull */
  chartVersion: string;
}

export interface UpImageOptions {
  continueOnError?: boolean;
}

interface RawDependency {
  name?: unknown;
  version?: unknown;
  repository?: unknown;
}

interface ChartShow {
  dependencies?: RawDependency[];
}

/**
 * FR-013-AC-1: parse `helm show chart` YAML to discover the app's
 * subcharts. Each entry's `repository` is expected to be an `oci://...`
 * URL pointing at the chart's OCI namespace (the chart name is appended
 * by the caller to form the full chartRef).
 */
export function parseChartDependencies(chartYaml: string): ChildInstall[] {
  const parsed = parseYaml(chartYaml) as ChartShow | null;
  const deps = parsed?.dependencies ?? [];
  return deps
    .filter(
      (d): d is { name: string; version: string; repository: string } =>
        typeof d.name === "string" &&
        typeof d.version === "string" &&
        typeof d.repository === "string",
    )
    .map((d) => ({
      name: d.name,
      chartVersion: d.version,
      chartRef: `${d.repository.replace(/\/$/, "")}/${d.name}`,
    }));
}

export interface AppExpander {
  (deployable: Deployable, config: IxConfig): Promise<ChildInstall[]>;
}

/**
 * Default app expander — runs `helm show chart` against the OCI registry.
 * Test seam: callers can inject a stub.
 */
export const defaultExpandApp: AppExpander = async (deployable, config) => {
  const chartRef = `oci://${config.helmChartRegistry}/${deployable.chartRepository}/${deployable.name}`;
  const { stdout } = await execa("helm", [
    "show",
    "chart",
    chartRef,
    "--version",
    deployable.version,
  ]);
  return parseChartDependencies(stdout);
};

function buildHelmInstallArgs(
  install: ChildInstall,
  config: IxConfig,
  imageTagOverride: string | null,
): string[] {
  const args = [
    "upgrade",
    "--install",
    install.name,
    install.chartRef,
    "--version",
    install.chartVersion,
    "--namespace",
    "default",
    "--take-ownership",
    "--set-string",
    `global.imageRegistry=${config.imageRegistry}`,
    "--set-string",
    `global.internalBaseDomain=${config.internalBaseDomain}`,
  ];
  if (imageTagOverride) {
    args.push("--set-string", `ix-service.image.tag=${imageTagOverride}`);
  }
  if (config.enableExternalHost && config.externalBaseDomain) {
    args.push(
      "--set-string",
      "global.enableExternalHost=true",
      "--set-string",
      `global.externalBaseDomain=${config.externalBaseDomain}`,
    );
  }
  args.push(...buildHelmSetArgs(resolveCatalog()));
  return args;
}

function buildHelmLocalInstallArgs(
  name: string,
  tgzPath: string,
  config: IxConfig,
  imageTagOverride: string | null,
): string[] {
  const args = [
    "upgrade",
    "--install",
    name,
    tgzPath,
    "--namespace",
    "default",
    "--take-ownership",
    "--set-string",
    `global.imageRegistry=${config.imageRegistry}`,
    "--set-string",
    `global.internalBaseDomain=${config.internalBaseDomain}`,
  ];
  if (imageTagOverride) {
    args.push("--set-string", `ix-service.image.tag=${imageTagOverride}`);
  }
  if (config.enableExternalHost && config.externalBaseDomain) {
    args.push(
      "--set-string",
      "global.enableExternalHost=true",
      "--set-string",
      `global.externalBaseDomain=${config.externalBaseDomain}`,
    );
  }
  args.push(...buildHelmSetArgs(resolveCatalog()));
  return args;
}

export async function runImageModeUp(
  deployable: Deployable,
  config: IxConfig,
  tagOverride: string | null,
  expandApp: AppExpander = defaultExpandApp,
  opts: UpImageOptions = {},
  devDir: string = "",
): Promise<void> {
  const headerText = `ix local up · ${deployable.name} · ${config.helmChartRegistry}`;

  let installs: ChildInstall[];
  let serviceList: Listing | null = null;
  let preflightList: Listing | null = null;

  if (deployable.role === "app") {
    preflightList = startListing(headerText);
    const deps = await expandApp(deployable, config);
    if (deps.length === 0) {
      preflightList.stop();
      // FR-013-AC-6
      throw new Error(
        `App '${deployable.name}' has no chart dependencies to install.`,
      );
    }
    installs = deps;
  } else {
    installs = [
      {
        name: deployable.name,
        chartRef: `oci://${config.helmChartRegistry}/${deployable.chartRepository}/${deployable.name}`,
        chartVersion: deployable.version,
      },
    ];
    serviceList = startListing(headerText);
    serviceList.commit();
  }

  // Resolve credentials before entering Listr / PhaseTable — interactive
  // prompts need direct terminal access.
  const ghcrToken = config.ghcrToken?.trim() || (await resolveGhcrToken(false));

  if (deployable.role !== "app") {
    // Single-service: Listr2 path (FR-022-CON-1, FR-021-CON-1)
    const contracts: SecretContract[] = [];
    if (devDir) {
      const repoDir = path.join(devDir, deployable.name);
      if (fs.existsSync(path.join(repoDir, SECRETS_FILENAME))) {
        const contract = await loadSecretContract(repoDir);
        if (contract && contract.secrets.length > 0) contracts.push(contract);
      }
    }
    await runSingleServiceListr(
      serviceList!,
      installs[0],
      deployable,
      config,
      tagOverride,
      ghcrToken,
      contracts,
      opts,
    );
    return;
  }

  // Multi-service app: concurrent phase-column display (FR-021, FR-022)

  // Validate concurrency config before any I/O — fail fast per FR-021-AC-7.
  // Must happen before display.start() so a bad config never leaves the ticker running.
  const concurrencyConfig = loadConcurrencyConfig();
  const pools = createPools(concurrencyConfig);

  const contractsByName = new Map<string, SecretContract>();
  if (devDir) {
    const candidateNames = [
      ...new Set([deployable.name, ...installs.map((i) => i.name)]),
    ];
    for (const name of candidateNames) {
      const repoDir = path.join(devDir, name);
      if (!fs.existsSync(path.join(repoDir, SECRETS_FILENAME))) continue;
      const contract = await loadSecretContract(repoDir);
      if (contract && contract.secrets.length > 0)
        contractsByName.set(name, contract);
    }
  }

  const display = new PhaseTable<Phase>(
    installs.map((i) => i.name),
    {
      phases: UP_PHASES,
      phaseLabels: UP_PHASE_LABELS,
      header: headerText,
      initialLineCount: 0,
    },
  );

  // Pre-flight: helm registry login before display.start() so a login failure
  // never leaves the TTY ticker running.
  await execa(
    "helm",
    [
      "registry",
      "login",
      config.helmChartRegistry,
      "-u",
      "_token",
      "--password-stdin",
    ],
    { input: ghcrToken, all: true },
  );
  preflightList!.stop();
  display.start();

  const failures: string[] = [];

  // mkdtempSync failure after display.start() would leak the ticker; handle it
  // explicitly so display.finish() still clears the interval.
  let tmpDir: string;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-helm-"));
  } catch (err) {
    display.finish(null, config.internalBaseDomain);
    throw err;
  }

  try {
    await Promise.all(
      installs.map(async (install) => {
        let currentPhase: Phase = "secrets";
        try {
          // --- secrets phase (FR-022: no secrets file → instant done) ---
          const contract = contractsByName.get(install.name);
          if (contract) {
            display.transition(install.name, "secrets", "running");
            await applySecretContract(contract, () => {});
          }
          display.transition(install.name, "secrets", "done");

          // --- pull phase (dockerPull pool) ---
          currentPhase = "pull";
          const serviceDir = path.join(tmpDir, install.name);
          fs.mkdirSync(serviceDir, { recursive: true });
          display.transition(install.name, "pull", "queued");
          await pools.dockerPull.run(async () => {
            display.transition(install.name, "pull", "running");
            await execa(
              "helm",
              [
                "pull",
                install.chartRef,
                "--version",
                install.chartVersion,
                "--destination",
                serviceDir,
              ],
              { all: true },
            );
            display.transition(install.name, "pull", "done");
          });

          const tgzFiles = fs
            .readdirSync(serviceDir)
            .filter((f) => f.endsWith(".tgz"));
          if (tgzFiles.length !== 1) {
            throw new Error(
              `Expected 1 .tgz after pull for ${install.name}, found ${tgzFiles.length}`,
            );
          }
          const tgzPath = path.join(serviceDir, tgzFiles[0]);

          // --- install phase (helmInstall pool) ---
          currentPhase = "install";
          display.transition(install.name, "install", "queued");
          await pools.helmInstall.run(async () => {
            display.transition(install.name, "install", "running");
            const args = buildHelmLocalInstallArgs(
              install.name,
              tgzPath,
              config,
              tagOverride,
            );
            await execa("helm", args, { all: true });
            display.transition(install.name, "install", "done");
          });

          // --- ready phase (kubectlWatch pool) ---
          currentPhase = "ready";
          display.transition(install.name, "ready", "queued");
          await pools.kubectlWatch.run(async () => {
            display.transition(install.name, "ready", "running");
            const rolloutSink = {
              output: "",
            } as unknown as ListrTaskWrapper<unknown, never, never>;
            await waitForRollout(
              install.name,
              "default",
              config.rolloutTimeoutSeconds,
              rolloutSink,
              `app.kubernetes.io/part-of=${install.name}`,
              (status) => display.setPodStatus(install.name, status),
            );
            display.transition(install.name, "ready", "done");
          });
        } catch (err) {
          display.transition(install.name, currentPhase, "failed");
          // Use kubectl stderr/stdout when available (strips the execa command prefix).
          const execaErr = err as {
            stderr?: string;
            all?: string;
            message?: string;
          };
          const rawMsg =
            (execaErr.all ?? execaErr.stderr ?? execaErr.message ?? String(err))
              .trim()
              .split("\n")
              .filter(Boolean)
              .pop() ?? String(err);

          let displayMsg = `${currentPhase}: ${rawMsg}`;
          if (currentPhase === "ready") {
            const diagnosis = await diagnosePodFailure(
              `app.kubernetes.io/part-of=${install.name}`,
              "default",
            );
            if (diagnosis) displayMsg = `${currentPhase}: ${diagnosis}`;
          }

          display.setError(install.name, displayMsg);
          failures.push(`${install.name}: ${displayMsg}`);
        }
      }),
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Always freeze the display — clears the ticker regardless of outcome.
    display.finish(deployable.entry, config.internalBaseDomain);
  }

  // FR-021-AC-6: exit 1 whenever any child failed, regardless of --continue-on-error.
  // (All siblings already ran to completion per AC-5.)
  if (failures.length > 0) {
    throw new Error(`App '${deployable.name}' failed: ${failures.join("; ")}`);
  }
}

async function runSingleServiceListr(
  list: Listing,
  install: ChildInstall,
  deployable: Deployable,
  config: IxConfig,
  tagOverride: string | null,
  ghcrToken: string,
  contracts: SecretContract[],
  opts: UpImageOptions,
): Promise<void> {
  const failures: string[] = [];

  const tasks = makeListr(
    [
      {
        title: `Authenticate Helm registry`,
        task: async (_ctx, task) => {
          const subprocess = execa(
            "helm",
            [
              "registry",
              "login",
              config.helmChartRegistry,
              "-u",
              "_token",
              "--password-stdin",
            ],
            { input: ghcrToken, all: true },
          );
          subprocess.all?.on("data", (chunk) => {
            const line = chunk.toString().trim();
            if (line) task.output = line;
          });
          await subprocess;
        },
      },

      ...contracts.map((contract) => ({
        title: `Apply repo secrets ${pc.cyan(path.basename(contract.repoDir))}`,
        task: async (_ctx: unknown, task: { output: string }) => {
          await applySecretContract(contract, (line) => {
            task.output = line;
          });
        },
      })),

      {
        title: `Install ${pc.cyan(install.name)}`,
        task: async (_ctx: unknown, task: { output: string }) => {
          try {
            const args = buildHelmInstallArgs(install, config, tagOverride);
            const subprocess = execa("helm", args, { all: true });
            subprocess.all?.on("data", (chunk) => {
              const line = chunk.toString().trim();
              if (line) task.output = line;
            });
            await subprocess;
            await waitForRollout(
              install.name,
              "default",
              config.rolloutTimeoutSeconds,
              task as Parameters<typeof waitForRollout>[3],
              `app.kubernetes.io/part-of=${install.name}`,
            );
          } catch (err) {
            if (!opts.continueOnError) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            failures.push(`${install.name}: ${msg}`);
            task.output = pc.yellow(`Skipped after failure: ${msg}`);
          }
        },
      },
    ],
    {
      concurrent: false,
      exitOnError: !opts.continueOnError,
    },
  );

  try {
    await tasks.run();
    if (failures.length > 0) {
      list.warn(
        `Deployed ${deployable.name} with failures: ${failures.join("; ")}`,
      );
    } else {
      const url = `https://${deployable.name}.${config.internalBaseDomain}`;
      list.note(`→  ${url}`);
      list.success(`${deployable.name} deployed.`);
    }
  } catch (err) {
    list.error(
      `Failed to deploy ${deployable.name}: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
