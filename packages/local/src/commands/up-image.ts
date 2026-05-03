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
import { buildGlobalSetArgs } from "../config.js";
import type { Deployable } from "../discovery.js";
import { resolveDeployableNamespace } from "../discovery.js";
import { resolveGhcrToken } from "../credentials.js";
import { buildHelmSetArgs, resolveCatalog } from "../host-mounts.js";
import { waitForRollout, diagnosePodFailure } from "../rollout.js";
import {
  applySecretContract,
  ensureGhcrCredsInNamespace,
  loadSecretContractFromTgz,
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
  "pull",
  "secrets",
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
  /**
   * Target Kubernetes namespace. Resolved by the caller from the parent
   * Deployable's namespace (`resolveDeployableNamespace`). Children inherit
   * the parent's namespace; per-child namespaces require chart-side support
   * via `org.agent-ix.namespace` on the child chart.
   */
  namespace: string;
}

export interface UpImageOptions {
  continueOnError?: boolean;
  /** Deploy-time namespace override; wins over chart annotation. */
  namespaceOverride?: string;
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
export function parseChartDependencies(
  chartYaml: string,
  namespace: string,
): ChildInstall[] {
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
      namespace,
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
  return parseChartDependencies(stdout, resolveDeployableNamespace(deployable));
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
    install.namespace,
    "--create-namespace",
    "--take-ownership",
  ];
  args.push(...buildGlobalSetArgs(config));
  if (imageTagOverride) {
    args.push("--set-string", `ix-service.image.tag=${imageTagOverride}`);
  }
  args.push(...buildHelmSetArgs(resolveCatalog()));
  return args;
}

/**
 * FR-031: Build helm args for installing an umbrella chart as a single
 * Helm release. The umbrella's Chart.yaml deps describe the subcharts;
 * Helm itself topologically installs them. We deliberately omit --wait
 * and --atomic so per-subchart rollout watchers (running in parallel)
 * can stream live status to the PhaseTable.
 */
function buildUmbrellaInstallArgs(
  releaseName: string,
  tgzPath: string,
  namespace: string,
  config: IxConfig,
  imageTagOverride: string | null,
): string[] {
  const args = [
    "upgrade",
    "--install",
    releaseName,
    tgzPath,
    "--namespace",
    namespace,
    "--create-namespace",
    "--take-ownership",
  ];
  args.push(...buildGlobalSetArgs(config));
  if (imageTagOverride) {
    args.push("--set-string", `global.imageTag=${imageTagOverride}`);
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
    installs = opts.namespaceOverride?.trim()
      ? deps.map((d) => ({ ...d, namespace: opts.namespaceOverride!.trim() }))
      : deps;
  } else {
    installs = [
      {
        name: deployable.name,
        chartRef: `oci://${config.helmChartRegistry}/${deployable.chartRepository}/${deployable.name}`,
        chartVersion: deployable.version,
        namespace:
          opts.namespaceOverride?.trim() ||
          resolveDeployableNamespace(deployable),
      },
    ];
    serviceList = startListing(headerText);
    serviceList.commit();
  }

  // Resolve credentials before entering Listr / PhaseTable — interactive
  // prompts need direct terminal access.
  const ghcrToken = config.ghcrToken?.trim() || (await resolveGhcrToken(false));

  // FR-032: ensure ghcr-creds exists in every install namespace BEFORE helm
  // install runs, so the kubelet can pull images. Image-mode pods reference
  // images on ghcr.io; without this secret pulls fail when images aren't
  // already cached on the kind node.
  const installNamespaces = new Set(installs.map((i) => i.namespace));
  for (const ns of installNamespaces) {
    await ensureGhcrCredsInNamespace(ns, ghcrToken);
  }

  if (deployable.role !== "app") {
    // Single-service: Listr2 path (FR-022-CON-1, FR-021-CON-1)
    // FR-033: pull the chart tgz to extract its secret contract, then install
    // from the local tgz to avoid a second OCI fetch.
    const svcTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-local-svc-"));
    const contracts: SecretContract[] = [];
    let svcTgzPath = installs[0].chartRef;
    try {
      await execa(
        "helm",
        [
          "pull",
          installs[0].chartRef,
          "--version",
          installs[0].chartVersion,
          "--destination",
          svcTmpDir,
        ],
        { all: true },
      );
      const tgzFiles = fs
        .readdirSync(svcTmpDir)
        .filter((f) => f.endsWith(".tgz"));
      if (tgzFiles.length === 1) {
        svcTgzPath = path.join(svcTmpDir, tgzFiles[0]);
        const contract = await loadSecretContractFromTgz(
          svcTgzPath,
          deployable.name,
        );
        if (contract && contract.secrets.length > 0) contracts.push(contract);
      }
    } catch (err) {
      fs.rmSync(svcTmpDir, { recursive: true, force: true });
      throw err;
    }
    await runSingleServiceListr(
      serviceList!,
      { ...installs[0], chartRef: svcTgzPath },
      deployable,
      config,
      tagOverride,
      ghcrToken,
      contracts,
      opts,
      svcTmpDir,
    );
    return;
  }

  // Multi-service app: concurrent phase-column display (FR-021, FR-022)

  // Validate concurrency config before any I/O — fail fast per FR-021-AC-7.
  // Must happen before display.start() so a bad config never leaves the ticker running.
  const concurrencyConfig = loadConcurrencyConfig();
  const pools = createPools(concurrencyConfig);

  // FR-033: contractsByName is built after the umbrella pull (from tgz).
  const contractsByName = new Map<string, SecretContract>();

  const APP_ROW = deployable.name;
  const display = new PhaseTable<Phase>(
    [APP_ROW, ...installs.map((i) => i.name)],
    {
      phases: UP_PHASES,
      phaseLabels: UP_PHASE_LABELS,
      header: headerText,
      initialLineCount: 0,
      serviceLabels: {
        [APP_ROW]: `${deployable.name} ${pc.dim(deployable.version)}`,
      },
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
    // FR-031: install the umbrella as a single Helm release.
    // FR-033: phase order is pull → secrets → install → ready.
    // Pull happens first so the tgz is available for secret contract extraction.

    // --- pull phase (single umbrella pull) ---
    const umbrellaRef = `oci://${config.helmChartRegistry}/${deployable.chartRepository}/${deployable.name}`;
    const umbrellaDir = path.join(tmpDir, deployable.name);
    fs.mkdirSync(umbrellaDir, { recursive: true });
    display.transition(APP_ROW, "pull", "running");
    installs.forEach((i) => display.transition(i.name, "pull", "running"));
    let umbrellaTgzPath: string;
    try {
      await execa(
        "helm",
        [
          "pull",
          umbrellaRef,
          "--version",
          deployable.version,
          "--destination",
          umbrellaDir,
        ],
        { all: true },
      );
      const tgzFiles = fs
        .readdirSync(umbrellaDir)
        .filter((f) => f.endsWith(".tgz"));
      if (tgzFiles.length !== 1) {
        throw new Error(
          `Expected 1 .tgz after pulling umbrella '${deployable.name}', found ${tgzFiles.length}`,
        );
      }
      umbrellaTgzPath = path.join(umbrellaDir, tgzFiles[0]);
      display.transition(APP_ROW, "pull", "done");
      installs.forEach((i) => display.transition(i.name, "pull", "done"));
    } catch (err) {
      display.transition(APP_ROW, "pull", "failed");
      installs.forEach((i) => display.transition(i.name, "pull", "failed"));
      const msg = err instanceof Error ? err.message : String(err);
      const failureMsg = `pull (umbrella): ${msg}`;
      display.setError(APP_ROW, failureMsg);
      failures.push(`${APP_ROW}: ${failureMsg}`);
      return; // umbrella pull failure is fatal — finally{} freezes display
    }

    // FR-033: extract secret contracts from subchart tgzs inside the umbrella.
    const umbrellaExtractDir = path.join(tmpDir, "umbrella-extracted");
    fs.mkdirSync(umbrellaExtractDir, { recursive: true });
    try {
      await execa("tar", ["-xzf", umbrellaTgzPath, "-C", umbrellaExtractDir]);
      const chartsDir = path.join(
        umbrellaExtractDir,
        deployable.name,
        "charts",
      );
      if (fs.existsSync(chartsDir)) {
        for (const install of installs) {
          const subchartTgzFiles = fs
            .readdirSync(chartsDir)
            .filter(
              (f) => f.endsWith(".tgz") && f.startsWith(`${install.name}-`),
            );
          for (const f of subchartTgzFiles) {
            const contract = await loadSecretContractFromTgz(
              path.join(chartsDir, f),
              install.name,
            );
            if (contract && contract.secrets.length > 0)
              contractsByName.set(install.name, contract);
          }
        }
      }
    } catch {
      // Secret contract extraction is best-effort; non-required secrets are
      // skipped gracefully, required ones fail in the secrets phase below.
    }

    // --- secrets phase (per-subchart, parallel) ---
    display.transition(APP_ROW, "secrets", "done");
    await Promise.all(
      installs.map(async (install) => {
        const contract = contractsByName.get(install.name);
        if (contract) {
          display.transition(install.name, "secrets", "running");
          const secretNames = contract.secrets.map((s) => s.name).join(", ");
          display.setPodStatus(install.name, `creating: ${secretNames}`);
          try {
            await applySecretContract(contract, install.namespace, (line) => {
              display.setPodStatus(install.name, line);
            });
            display.transition(install.name, "secrets", "done");
          } catch (err) {
            display.transition(install.name, "secrets", "failed");
            const msg = err instanceof Error ? err.message : String(err);
            display.setError(install.name, `secrets: ${msg}`);
            failures.push(`${install.name}: secrets: ${msg}`);
          }
        } else {
          display.transition(install.name, "secrets", "done");
        }
      }),
    );

    // --- install phase (single umbrella `helm upgrade --install`) ---
    // No --wait/--atomic: we want per-subchart rollout watchers below to
    // stream live status into the table instead of one opaque spinner.
    const umbrellaNamespace = installs[0].namespace;
    display.transition(APP_ROW, "install", "running");
    installs.forEach((i) => display.transition(i.name, "install", "running"));
    try {
      const args = buildUmbrellaInstallArgs(
        deployable.name,
        umbrellaTgzPath,
        umbrellaNamespace,
        config,
        tagOverride,
      );
      await execa("helm", args, { all: true });
      display.transition(APP_ROW, "install", "done");
      installs.forEach((i) => display.transition(i.name, "install", "done"));
    } catch (err) {
      display.transition(APP_ROW, "install", "failed");
      installs.forEach((i) => display.transition(i.name, "install", "failed"));
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
      const failureMsg = `install (umbrella): ${rawMsg}`;
      display.setError(APP_ROW, failureMsg);
      failures.push(`${APP_ROW}: ${failureMsg}`);
      return;
    }

    // --- ready phase (per-subchart rollout watchers, parallel) ---
    display.transition(APP_ROW, "ready", "running");
    let anyReadyFailed = false;
    await Promise.all(
      installs.map((install) =>
        pools.kubectlWatch.run(async () => {
          display.transition(install.name, "ready", "running");
          try {
            const rolloutSink = {
              output: "",
            } as unknown as ListrTaskWrapper<unknown, never, never>;
            await waitForRollout(
              install.name,
              install.namespace,
              config.rolloutTimeoutSeconds,
              rolloutSink,
              `app.kubernetes.io/instance=${install.name}`,
              (status) => display.setPodStatus(install.name, status),
            );
            display.transition(install.name, "ready", "done");
          } catch (err) {
            anyReadyFailed = true;
            display.transition(install.name, "ready", "failed");
            const execaErr = err as {
              stderr?: string;
              all?: string;
              message?: string;
            };
            const rawMsg =
              (
                execaErr.all ??
                execaErr.stderr ??
                execaErr.message ??
                String(err)
              )
                .trim()
                .split("\n")
                .filter(Boolean)
                .pop() ?? String(err);
            let displayMsg = `ready: ${rawMsg}`;
            const diagnosis = await diagnosePodFailure(
              `app.kubernetes.io/instance=${install.name}`,
              install.namespace,
            );
            if (diagnosis) displayMsg = `ready: ${diagnosis}`;
            display.setError(install.name, displayMsg);
            failures.push(`${install.name}: ${displayMsg}`);
          }
        }),
      ),
    );
    display.transition(APP_ROW, "ready", anyReadyFailed ? "failed" : "done");
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
  tmpDir?: string,
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

      ...contracts.map((contract) => {
        const chartName = path.basename(contract.repoDir);
        const secretNames = contract.secrets.map((s) => s.name).join(", ");
        return {
          title: `Apply secrets [${pc.cyan(secretNames)}] from ${chartName}`,
          task: async (_ctx: unknown, task: { output: string }) => {
            await applySecretContract(contract, install.namespace, (line) => {
              task.output = line;
            });
          },
        };
      }),

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
            const nullSink = {
              output: "",
            } as unknown as ListrTaskWrapper<unknown, never, never>;
            await waitForRollout(
              install.name,
              install.namespace,
              config.rolloutTimeoutSeconds,
              nullSink,
              `app.kubernetes.io/instance=${install.name}`,
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
      list.success(`${deployable.name} deployed.`);
    }
  } catch (err) {
    list.error(
      `Failed to deploy ${deployable.name}: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
