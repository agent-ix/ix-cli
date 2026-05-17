import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import pc from "picocolors";
import { parse as parseYaml } from "yaml";
import type { ServiceRow } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "./config.js";
import {
  buildAuthServiceSetArgs,
  buildGlobalSetArgs,
  buildTunnelSetArgs,
  loadTunnelConfig,
} from "./config.js";
import type { Deployable } from "./discovery.js";
import { resolveDeployableNamespace } from "./discovery.js";
import { resolveGhcrToken } from "./credentials.js";
import { buildHelmSetArgs, resolveCatalog } from "./host-mounts.js";
import { getReleaseIngressUrls } from "./ingress.js";
import {
  applySecretContract,
  ensureGhcrCredsInNamespace,
  loadSecretContract,
  loadSecretContractFromTgz,
  type SecretContract,
} from "./local-secrets.js";
import { ensureNamespace } from "./namespaces.js";
import { PhaseRows, createPhaseRows } from "./phase-rows.js";
import { PHASES, type Phase } from "./phases.js";
import { loadConcurrencyConfig, createPools } from "./pool.js";
import {
  cleanupFailedHelmHookJobs,
  waitForRollout,
  diagnosePodFailure,
  detectHelmHookStatuses,
  getRolloutReadyStatus,
  type HookStatus,
} from "./rollout.js";
import { AppInstallRows } from "./app-row-state.js";

export interface ChildInstall {
  name: string;
  chartRef: string;
  chartVersion: string;
  namespace: string;
}

export interface UpImageOptions {
  continueOnError?: boolean;
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
  // Single-service release: tunnel toggle, when present, applies at
  // top-level (entryKey=null). buildTunnelSetArgs returns [] when the
  // release isn't in tunnel.exposed, so this is a no-op for the common
  // case.
  args.push(...buildTunnelSetArgs(loadTunnelConfig(), install.name, null));
  if (install.name === "auth-service") {
    args.push(...buildAuthServiceSetArgs(null));
  }
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

function buildUmbrellaInstallArgs(
  releaseName: string,
  tgzPath: string,
  namespace: string,
  config: IxConfig,
  imageTagOverride: string | null,
  childInstalls: ChildInstall[],
  entryKey: string | null,
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
  // Umbrella release: tunnel toggle (when intent is recorded) goes on
  // the entry subchart only — non-entry subcharts stay LAN-scoped per
  // FR-037-AC-7.
  args.push(...buildTunnelSetArgs(loadTunnelConfig(), releaseName, entryKey));
  const authService = childInstalls.find(
    (child) => child.name === "auth-service",
  );
  if (authService) {
    args.push(...buildAuthServiceSetArgs(authService.name));
  }
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

export type ImageModePlan =
  | { mode: "service"; install: ChildInstall }
  | {
      mode: "app";
      installs: ChildInstall[];
      pools: ReturnType<typeof createPools>;
    };

export async function planImageModeUp(
  deployable: Deployable,
  config: IxConfig,
  expandApp: AppExpander,
  opts: UpImageOptions,
): Promise<ImageModePlan> {
  const ghcrToken = await resolveGhcrToken(false);

  if (deployable.role !== "app") {
    const install: ChildInstall = {
      name: deployable.name,
      chartRef: `oci://${config.helmChartRegistry}/${deployable.chartRepository}/${deployable.name}`,
      chartVersion: deployable.version,
      namespace:
        opts.namespaceOverride?.trim() ||
        resolveDeployableNamespace(deployable),
    };
    await ensureNamespace(install.namespace);
    await ensureGhcrCredsInNamespace(install.namespace, ghcrToken);
    await authenticateHelmRegistry(config, ghcrToken);
    return { mode: "service", install };
  }

  const concurrencyConfig = loadConcurrencyConfig();
  const pools = createPools(concurrencyConfig);
  await authenticateHelmRegistry(config, ghcrToken);
  const deps = await expandApp(deployable, config);
  if (deps.length === 0) {
    throw new Error(
      `App '${deployable.name}' has no chart dependencies to install.`,
    );
  }
  const installs: ChildInstall[] = opts.namespaceOverride?.trim()
    ? deps.map((d) => ({ ...d, namespace: opts.namespaceOverride!.trim() }))
    : deps;

  const installNamespaces = new Set(installs.map((i) => i.namespace));
  for (const ns of installNamespaces) {
    await ensureNamespace(ns);
    await ensureGhcrCredsInNamespace(ns, ghcrToken);
  }

  return { mode: "app", installs, pools };
}

export function initialImageRows(
  installs: ChildInstall[],
): ServiceRow<Phase>[] {
  return createPhaseRows(
    installs.map((install) => ({
      name: install.name,
      displayName: `${install.name} ${pc.dim(install.chartVersion)}`,
    })),
    PHASES,
  );
}

export interface SingleServicePipelineOptions {
  install: ChildInstall;
  deployable: Deployable;
  config: IxConfig;
  tagOverride: string | null;
  opts: UpImageOptions;
}

export interface ImageInstallPipelineResult {
  failures: string[];
  finalDisplayError: string | null;
  ingressUrls: string[];
}

export class ImageInstallPipelineError extends Error {
  constructor(
    cause: Error,
    readonly failures: string[],
    readonly finalDisplayError: string | null,
  ) {
    super(cause.message);
    this.name = "ImageInstallPipelineError";
    this.cause = cause;
  }
}

export async function runSingleServicePipeline(
  {
    install,
    deployable,
    config,
    tagOverride,
    opts,
  }: SingleServicePipelineOptions,
  emit: (services: ServiceRow<Phase>[]) => void,
): Promise<ImageInstallPipelineResult> {
  const rows = new PhaseRows(
    [
      {
        name: install.name,
        displayName: `${install.name} ${pc.dim(install.chartVersion)}`,
      },
    ],
    PHASES,
    emit,
  );
  const failures: string[] = [];
  const svcTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-local-svc-"));
  let chartRef = install.chartRef;
  let phase: Phase = "pull";

  try {
    rows.setPhase(install.name, "pull", "running", "helm pull");
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
    const contracts: SecretContract[] = [];
    if (tgzFiles.length === 1) {
      chartRef = path.join(svcTmpDir, tgzFiles[0]);
      const contract = await loadSecretContractFromTgz(
        chartRef,
        deployable.name,
      );
      if (contract && contract.secrets.length > 0) contracts.push(contract);
    }
    rows.setPhase(install.name, "pull", "done");

    phase = "secrets";
    rows.setPhase(install.name, "secrets", "running", "checking secrets");
    try {
      for (const contract of contracts) {
        await applySecretContract(contract, install.namespace);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.setError(install.name, "secrets", msg);
      throw err;
    }
    rows.setPhase(install.name, "secrets", "done");

    try {
      phase = "install";
      rows.setPhase(install.name, "install", "running", "helm upgrade");
      const args = buildHelmInstallArgs(
        { ...install, chartRef },
        config,
        tagOverride,
      );
      await execa("helm", args, { all: true });
      rows.setPhase(install.name, "install", "done");

      phase = "ready";
      rows.setPhase(install.name, "ready", "running", "checking rollout");
      await waitForRollout(
        install.name,
        install.namespace,
        config.rolloutTimeoutSeconds,
        undefined,
        `app.kubernetes.io/instance=${install.name}`,
        (status) => rows.setPhase(install.name, "ready", "running", status),
      );
      rows.setPhase(install.name, "ready", "done", "ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.setError(install.name, phase, msg);
      rows.finishPending(install.name, phase);
      if (!opts.continueOnError) throw err;
      failures.push(`${install.name}: ${msg}`);
    }

    return {
      failures,
      finalDisplayError: null,
      ingressUrls:
        failures.length === 0
          ? await getReleaseIngressUrls(install.name, install.namespace)
          : [],
    };
  } catch (err) {
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new ImageInstallPipelineError(cause, failures, cause.message);
  } finally {
    fs.rmSync(svcTmpDir, { recursive: true, force: true });
  }
}

interface AppInstallPipelineOptions {
  deployable: Deployable;
  installs: ChildInstall[];
  config: IxConfig;
  tagOverride: string | null;
  pools: ReturnType<typeof createPools>;
  appRows: AppInstallRows;
}

export async function runAppInstallPipeline({
  deployable,
  installs,
  config,
  tagOverride,
  pools,
  appRows,
}: AppInstallPipelineOptions): Promise<ImageInstallPipelineResult> {
  const failures: string[] = [];
  let finalDisplayError: string | null = null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-helm-"));

  try {
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
      // Secret contracts in bundled subcharts are best effort.
    }

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

    const umbrellaNamespace = resolveDeployableNamespace(deployable);
    installs.forEach((i) => appRows.transition(i.name, "install", "pending"));
    let ingressUrls: string[] = [];
    try {
      await cleanupFailedHelmHookJobs(umbrellaNamespace, deployable.name);
      const args = buildUmbrellaInstallArgs(
        deployable.name,
        umbrellaTgzPath,
        umbrellaNamespace,
        config,
        tagOverride,
        installs,
        deployable.role === "app" ? (deployable.entry ?? null) : null,
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
      ingressUrls = await getReleaseIngressUrls(
        deployable.name,
        umbrellaNamespace,
      );
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

    return { failures, finalDisplayError, ingressUrls };
  } catch (err) {
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new ImageInstallPipelineError(cause, failures, finalDisplayError);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function appRowServices(installs: ChildInstall[]): {
  name: string;
  displayName: string;
}[] {
  return installs.map((i) => ({
    name: i.name,
    displayName: `${i.name} ${pc.dim(i.chartVersion)}`,
  }));
}
