/**
 * FR-008 — Image-Mode Deployable Installation
 * FR-013 — Composable App Expansion
 * FR-021 — Concurrent Service Startup with Rate Control
 * FR-022 — App Startup Display
 *
 * For role=service, install one chart as a Helm release sequentially.
 * For role=app, expand the chart's `dependencies` and run each child
 * pipeline concurrently behind Pool-gated semaphores, displaying progress
 * in the phase-column table (PhaseTable from @agent-ix/ix-ui-cli).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import pc from "picocolors";
import { parse as parseYaml } from "yaml";
import type { IxConfig } from "../config.js";
import { buildGlobalSetArgs } from "../config.js";
import type { Deployable } from "../discovery.js";
import { resolveDeployableNamespace } from "../discovery.js";
import { resolveGhcrToken } from "../credentials.js";
import { buildHelmSetArgs, resolveCatalog } from "../host-mounts.js";
import {
  cleanupFailedHelmHookJobs,
  waitForRollout,
  diagnosePodFailure,
  detectHelmHookStatuses,
  getRolloutReadyStatus,
  type HookStatus,
} from "../rollout.js";
import {
  applySecretContract,
  ensureGhcrCredsInNamespace,
  loadSecretContract,
  loadSecretContractFromTgz,
  type SecretContract,
} from "../local-secrets.js";
import { ensureNamespace } from "../namespaces.js";
import {
  Listing,
  renderStatic,
  type ServiceRow,
  type TailVariant,
} from "@agent-ix/ix-ui-cli";
import { PHASES, PHASE_LABELS, type Phase } from "../phases.js";
import { AppInstallRows } from "../app-row-state.js";
import { loadConcurrencyConfig, createPools } from "../pool.js";
import { renderPhaseTableRun } from "../phase-table-runner.js";

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

async function loadBundledSubchartContract(
  chartsDir: string,
  install: ChildInstall,
): Promise<SecretContract | null> {
  const directoryPath = path.join(chartsDir, install.name);
  if (
    fs.existsSync(directoryPath) &&
    fs.statSync(directoryPath).isDirectory()
  ) {
    const contract = await loadSecretContract(directoryPath);
    if (contract && contract.secrets.length > 0) return contract;
  }

  const subchartTgzFiles = fs
    .readdirSync(chartsDir)
    .filter((f) => f.endsWith(".tgz") && f.startsWith(`${install.name}-`));
  for (const f of subchartTgzFiles) {
    const contract = await loadSecretContractFromTgz(
      path.join(chartsDir, f),
      install.name,
    );
    if (contract && contract.secrets.length > 0) return contract;
  }

  return null;
}

function findInstallForHookJob(
  installs: ChildInstall[],
  jobName: string,
): ChildInstall | null {
  return (
    installs
      .filter(
        (install) =>
          jobName === install.name ||
          jobName.startsWith(`${install.name}-`) ||
          jobName.includes(`-${install.name}-`) ||
          jobName.endsWith(`-${install.name}`),
      )
      .sort((a, b) => b.name.length - a.name.length)[0] ?? null
  );
}

function parseHookFailureMessage(
  rawMsg: string,
): { jobName: string; message: string } | null {
  const directHookMatch = rawMsg.match(/^hook ([^ ]+) failed: (.+)$/);
  if (directHookMatch) {
    return { jobName: directHookMatch[1], message: directHookMatch[2] };
  }

  const helmJobMatch = rawMsg.match(/\bjob\s+(\S+)\s+failed:\s*(.+)$/);
  if (helmJobMatch) {
    return { jobName: helmJobMatch[1], message: helmJobMatch[2] };
  }

  return null;
}

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
  if (shouldForceImagePull(imageTagOverride)) {
    args.push("--set-string", "ix-service.image.pullPolicy=Always");
  }
  args.push(...buildHelmSetArgs(resolveCatalog()));
  return args;
}

function shouldForceImagePull(imageTagOverride: string | null): boolean {
  return imageTagOverride === null || imageTagOverride === "latest";
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
  childInstalls: ChildInstall[],
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
  if (shouldForceImagePull(imageTagOverride)) {
    for (const child of childInstalls) {
      args.push(
        "--set-string",
        `${child.name}.ix-service.image.pullPolicy=Always`,
      );
    }
  }
  args.push(...buildHelmSetArgs(resolveCatalog()));
  return args;
}

async function authenticateHelmRegistry(
  config: IxConfig,
  ghcrToken: string,
): Promise<void> {
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
}

export async function runImageModeUp(
  deployable: Deployable,
  config: IxConfig,
  tagOverride: string | null,
  expandApp: AppExpander = defaultExpandApp,
  opts: UpImageOptions = {},
): Promise<void> {
  const headerText = `ix local up · ${deployable.name} · ${config.helmChartRegistry}`;
  const ghcrToken = await resolveGhcrToken(false);

  if (deployable.role !== "app") {
    // Single-service path — sequential; final-state Listing.
    const install: ChildInstall = {
      name: deployable.name,
      chartRef: `oci://${config.helmChartRegistry}/${deployable.chartRepository}/${deployable.name}`,
      chartVersion: deployable.version,
      namespace:
        opts.namespaceOverride?.trim() ||
        resolveDeployableNamespace(deployable),
    };

    // FR-032: ensure ghcr-creds in install namespace.
    await ensureNamespace(install.namespace);
    await ensureGhcrCredsInNamespace(install.namespace, ghcrToken);

    // FR-033: pull tgz first, extract secret contract, install from local tgz.
    const svcTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-local-svc-"));
    try {
      await runSingleServiceFlow(
        headerText,
        install,
        deployable,
        config,
        tagOverride,
        ghcrToken,
        opts,
        svcTmpDir,
      );
    } finally {
      fs.rmSync(svcTmpDir, { recursive: true, force: true });
    }
    return;
  }

  // Multi-service app path.
  // Validate concurrency config before any I/O — fail fast per FR-021-AC-7.
  const concurrencyConfig = loadConcurrencyConfig();
  const pools = createPools(concurrencyConfig);

  // Authenticate + expand app dependencies before building the live UI so
  // any expand failure aborts cleanly without paint flicker.
  await authenticateHelmRegistry(config, ghcrToken);
  const deps = await expandApp(deployable, config);
  if (deps.length === 0) {
    // FR-013-AC-6
    throw new Error(
      `App '${deployable.name}' has no chart dependencies to install.`,
    );
  }
  const installs: ChildInstall[] = opts.namespaceOverride?.trim()
    ? deps.map((d) => ({ ...d, namespace: opts.namespaceOverride!.trim() }))
    : deps;

  // FR-032: ensure ghcr-creds in every install namespace.
  const installNamespaces = new Set(installs.map((i) => i.namespace));
  for (const ns of installNamespaces) {
    await ensureNamespace(ns);
    await ensureGhcrCredsInNamespace(ns, ghcrToken);
  }

  await runAppFlow(
    headerText,
    deployable,
    installs,
    config,
    tagOverride,
    pools,
  );
}

/* ---------- single-service path ---------- */

async function runSingleServiceFlow(
  header: string,
  install: ChildInstall,
  deployable: Deployable,
  config: IxConfig,
  tagOverride: string | null,
  ghcrToken: string,
  opts: UpImageOptions,
  svcTmpDir: string,
): Promise<void> {
  try {
    await authenticateHelmRegistry(config, ghcrToken);
    await execa(
      "helm",
      [
        "pull",
        install.chartRef,
        "--version",
        install.chartVersion,
        "--destination",
        svcTmpDir,
      ],
      { all: true },
    );
    const tgzFiles = fs
      .readdirSync(svcTmpDir)
      .filter((f) => f.endsWith(".tgz"));
    let chartRef = install.chartRef;
    const contracts: SecretContract[] = [];
    if (tgzFiles.length === 1) {
      chartRef = path.join(svcTmpDir, tgzFiles[0]);
      const contract = await loadSecretContractFromTgz(
        chartRef,
        deployable.name,
      );
      if (contract && contract.secrets.length > 0) contracts.push(contract);
    }

    for (const contract of contracts) {
      await applySecretContract(contract, install.namespace);
    }

    const failures: string[] = [];
    try {
      const args = buildHelmInstallArgs(
        { ...install, chartRef },
        config,
        tagOverride,
      );
      await execa("helm", args, { all: true });
      await waitForRollout(
        install.name,
        install.namespace,
        config.rolloutTimeoutSeconds,
        undefined,
        `app.kubernetes.io/instance=${install.name}`,
      );
    } catch (err) {
      if (!opts.continueOnError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${install.name}: ${msg}`);
    }

    const tail =
      failures.length > 0
        ? `Deployed ${deployable.name} with failures: ${failures.join("; ")}`
        : `${deployable.name} deployed.`;
    const tailVariant: TailVariant = failures.length > 0 ? "warn" : "success";

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={tail}
        tailVariant={tailVariant}
      />,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={header}
        status="failed"
        tail={`Failed to deploy ${deployable.name}: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  }
}

/* ---------- app (multi-service) path ---------- */

interface AppInstallPipelineOptions {
  deployable: Deployable;
  installs: ChildInstall[];
  config: IxConfig;
  tagOverride: string | null;
  pools: ReturnType<typeof createPools>;
  appRows: AppInstallRows;
}

interface AppInstallPipelineResult {
  failures: string[];
  finalDisplayError: string | null;
}

class AppInstallPipelineError extends Error {
  constructor(
    cause: Error,
    readonly failures: string[],
    readonly finalDisplayError: string | null,
  ) {
    super(cause.message);
    this.name = "AppInstallPipelineError";
    this.cause = cause;
  }
}

async function runAppInstallPipeline({
  deployable,
  installs,
  config,
  tagOverride,
  pools,
  appRows,
}: AppInstallPipelineOptions): Promise<AppInstallPipelineResult> {
  const failures: string[] = [];
  let finalDisplayError: string | null = null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-helm-"));

  try {
    // --- pull phase ---
    const umbrellaRef = `oci://${config.helmChartRegistry}/${deployable.chartRepository}/${deployable.name}`;
    const umbrellaDir = path.join(tmpDir, deployable.name);
    fs.mkdirSync(umbrellaDir, { recursive: true });
    installs.forEach((i) => appRows.transition(i.name, "pull", "running"));

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
      installs.forEach((i) => appRows.transition(i.name, "pull", "done"));
    } catch (err) {
      installs.forEach((i) => appRows.transition(i.name, "pull", "failed"));
      const msg = err instanceof Error ? err.message : String(err);
      const failureMsg = `pull (umbrella): ${msg}`;
      installs.forEach((i) => appRows.setError(i.name, failureMsg));
      failures.push(`${deployable.name}: ${failureMsg}`);
      throw new Error(
        `App '${deployable.name}' failed: ${failures.join("; ")}`,
      );
    }

    // FR-033: extract secret contracts from subcharts bundled inside the umbrella.
    const contractsByName = new Map<string, SecretContract>();
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
          const contract = await loadBundledSubchartContract(
            chartsDir,
            install,
          );
          if (contract) contractsByName.set(install.name, contract);
        }
      }
    } catch {
      // best effort
    }

    // --- secrets phase ---
    await Promise.all(
      installs.map(async (install) => {
        const contract = contractsByName.get(install.name);
        if (!contract) {
          appRows.transition(install.name, "secrets", "done");
          return;
        }

        const secretNames = contract.secrets.map((s) => s.name).join(", ");
        appRows.transition(
          install.name,
          "secrets",
          "running",
          "secrets",
          `creating: ${secretNames}`,
        );
        try {
          await applySecretContract(contract, install.namespace);
          appRows.transition(install.name, "secrets", "done");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          appRows.transition(install.name, "secrets", "failed");
          appRows.setError(install.name, `secrets: ${msg}`);
          failures.push(`${install.name}: secrets: ${msg}`);
        }
      }),
    );

    // --- install phase ---
    const umbrellaNamespace = resolveDeployableNamespace(deployable);
    installs.forEach((i) => appRows.transition(i.name, "install", "pending"));
    try {
      await cleanupFailedHelmHookJobs(umbrellaNamespace, deployable.name);
      const args = buildUmbrellaInstallArgs(
        deployable.name,
        umbrellaTgzPath,
        umbrellaNamespace,
        config,
        tagOverride,
        installs,
      );
      const hookFailureRef: { current: HookStatus | null } = { current: null };
      const subprocess = execa("helm", args, { all: true });
      const checkHookStatus = () => {
        void detectHelmHookStatuses(umbrellaNamespace, deployable.name).then(
          (statuses) => {
            const activeHookRows = new Set<string>();
            for (const status of statuses) {
              const install = findInstallForHookJob(installs, status.jobName);
              if (install) {
                appRows.updateHook(install.name, status);
                activeHookRows.add(install.name);
              }
              if (status.phase === "failed" && !hookFailureRef.current) {
                hookFailureRef.current = status;
                subprocess.kill();
              }
            }
            appRows.reconcileActiveInstallHooks(activeHookRows);
          },
        );
      };
      const checkK8sStatus = () => {
        void Promise.all(
          installs.map(async (install) => {
            const status = await getRolloutReadyStatus(
              install.name,
              install.namespace,
              `app.kubernetes.io/instance=${install.name}`,
            );
            if (status) appRows.updateK8sInstallStatus(install.name, status);
          }),
        );
      };
      const checkInstallStatus = () => {
        checkHookStatus();
        checkK8sStatus();
      };
      checkInstallStatus();
      const poller = setInterval(checkInstallStatus, 1000);
      try {
        await subprocess;
      } catch (err) {
        if (hookFailureRef.current) {
          const failure = hookFailureRef.current;
          throw new Error(`hook ${failure.jobName} failed: ${failure.message}`);
        }
        throw err;
      } finally {
        clearInterval(poller);
      }
      installs.forEach((i) => appRows.completeInstall(i.name));
    } catch (err) {
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
      const hookFailure = parseHookFailureMessage(rawMsg);
      let matchedHookRow = false;
      if (hookFailure) {
        const install = findInstallForHookJob(installs, hookFailure.jobName);
        if (install) {
          matchedHookRow = true;
          appRows.failInstall(
            install.name,
            hookFailure.message,
            `install: hook ${hookFailure.jobName} failed: ${hookFailure.message}`,
          );
          failures.push(
            `${install.name}: install: hook ${hookFailure.jobName} failed: ${hookFailure.message}`,
          );
        }
      }
      const failureMsg = `install (umbrella): ${rawMsg}`;
      if (!matchedHookRow) {
        finalDisplayError = failureMsg;
        failures.push(`${deployable.name}: ${failureMsg}`);
      }
      throw new Error(
        `App '${deployable.name}' failed: ${failures.join("; ")}`,
      );
    }

    // --- ready phase ---
    await Promise.all(
      installs.map((install) =>
        pools.kubectlWatch.run(async () => {
          appRows.startReady(install.name);
          try {
            await waitForRollout(
              install.name,
              install.namespace,
              config.rolloutTimeoutSeconds,
              undefined,
              `app.kubernetes.io/instance=${install.name}`,
              (status) => appRows.updateReadyStatus(install.name, status),
            );
            appRows.completeReady(install.name);
          } catch (err) {
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
            appRows.failReady(install.name, "rollout failed", displayMsg);
            failures.push(`${install.name}: ${displayMsg}`);
          }
        }),
      ),
    );

    return { failures, finalDisplayError };
  } catch (err) {
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new AppInstallPipelineError(cause, failures, finalDisplayError);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function initialAppServiceRows(installs: ChildInstall[]): ServiceRow<Phase>[] {
  const serviceLabels: Record<string, string> = {};
  for (const install of installs) {
    serviceLabels[install.name] =
      `${install.name} ${pc.dim(install.chartVersion)}`;
  }

  return installs.map((i) => ({
    name: i.name,
    displayName: serviceLabels[i.name],
    phases: {
      pull: "pending",
      secrets: "pending",
      install: "pending",
      ready: "pending",
    },
    status: null,
    error: null,
  }));
}

function appRowServices(installs: ChildInstall[]): {
  name: string;
  displayName: string;
}[] {
  return installs.map((i) => ({
    name: i.name,
    displayName: `${i.name} ${pc.dim(i.chartVersion)}`,
  }));
}

async function runAppFlow(
  header: string,
  deployable: Deployable,
  installs: ChildInstall[],
  config: IxConfig,
  tagOverride: string | null,
  pools: ReturnType<typeof createPools>,
): Promise<void> {
  const result = await renderPhaseTableRun<Phase, AppInstallPipelineResult>({
    header,
    phases: PHASES,
    phaseLabels: PHASE_LABELS,
    initialServices: initialAppServiceRows(installs),
    controller: (emit) => {
      const appRows = new AppInstallRows(appRowServices(installs), emit);
      return runAppInstallPipeline({
        deployable,
        installs,
        config,
        tagOverride,
        pools,
        appRows,
      });
    },
    frameForSuccess: ({ failures }) =>
      failures.length > 0
        ? {
            status: "failed",
            tail: `${failures.length} service${failures.length === 1 ? "" : "s"} failed`,
            tailVariant: "error",
          }
        : {
            status: "passed",
            tailEntry: {
              name: deployable.name,
              baseDomain: config.internalBaseDomain,
            },
          },
    frameForError: (err) => ({
      status: "failed",
      tail:
        err instanceof AppInstallPipelineError
          ? (err.finalDisplayError ?? err.message)
          : err.message,
      tailVariant: "error",
    }),
  });

  // FR-021-AC-6
  if (result.failures.length > 0) {
    throw new Error(
      `App '${deployable.name}' failed: ${result.failures.join("; ")}`,
    );
  }
}
