import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import pc from "picocolors";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ServiceRow } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "./config.js";
import { IX_APPS_NAMESPACE, buildGlobalSetArgs } from "./config.js";
import { resolveGhcrToken } from "./credentials.js";
import {
  buildHelmSetArgs,
  resolveCatalog,
  resolveProfile,
} from "./host-mounts.js";
import {
  SECRETS_FILENAME,
  applySecretContract,
  loadSecretContract,
} from "./local-secrets.js";
import { ensureNamespace } from "./namespaces.js";
import { PhaseRows, createPhaseRows } from "./phase-rows.js";
import { waitForRollout } from "./rollout.js";

/**
 * Resolve the values overlay file for an app chart, profile-aware.
 * Lookup order: values-${IX_PROFILE}.yaml -> values-local.yaml -> values.yaml
 */
export function resolveProfileValuesPath(chartPath: string): string {
  const profile = resolveProfile();
  const profileFile = path.join(chartPath, `values-${profile}.yaml`);
  if (fs.existsSync(profileFile)) return profileFile;
  const localFile = path.join(chartPath, "values-local.yaml");
  if (fs.existsSync(localFile)) return localFile;
  return path.join(chartPath, "values.yaml");
}

interface LocalInstall {
  name: string;
  chartPath: string;
  valuesFiles: string[];
  repoDir: string;
  secretContractDir: string;
  dependencyUpdate: boolean;
  tags: string[];
  namespace: string;
}

export type SourcePhase = "secrets" | "build" | "install" | "ready";

export const SOURCE_PHASES: readonly SourcePhase[] = [
  "secrets",
  "build",
  "install",
  "ready",
];

export const SOURCE_PHASE_LABELS: Record<SourcePhase, string> = {
  secrets: "secrets",
  build: "building",
  install: "installing",
  ready: "ready",
};

export interface SourceModeResult {
  failures: string[];
  urls: string[];
}

interface RawDependency {
  name?: unknown;
  version?: unknown;
}

interface ChartFile {
  dependencies?: RawDependency[];
  annotations?: Record<string, unknown>;
}

export interface UpFilterOptions {
  includeTag?: string;
  excludeTag?: string;
  continueOnError?: boolean;
  namespaceOverride?: string;
  refresh?: boolean;
}

function readYamlFile(filePath: string): unknown {
  return parseYaml(fs.readFileSync(filePath, "utf-8"));
}

function ensureDirExists(dirPath: string, message: string): void {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`${message}: ${dirPath}`);
  }
}

function hasVendoredDependency(
  chartPath: string,
  dep: { name: string; version?: unknown },
): boolean {
  const chartsDir = path.join(chartPath, "charts");
  if (!fs.existsSync(chartsDir)) return false;
  if (fs.existsSync(path.join(chartsDir, dep.name))) return true;
  if (typeof dep.version === "string" && dep.version.trim() !== "") {
    return fs.existsSync(
      path.join(chartsDir, `${dep.name}-${dep.version}.tgz`),
    );
  }
  return false;
}

function shouldDependencyUpdate(chartPath: string): boolean {
  const chartYamlPath = path.join(chartPath, "Chart.yaml");
  if (!fs.existsSync(chartYamlPath)) return false;
  const parsed = readYamlFile(chartYamlPath) as ChartFile | null;
  const deps = (parsed?.dependencies ?? []).filter(
    (dep): dep is { name: string; version?: unknown } =>
      typeof dep.name === "string" && dep.name.trim() !== "",
  );
  if (deps.length === 0) return false;
  return deps.some((dep) => !hasVendoredDependency(chartPath, dep));
}

function parseChartTags(chartPath: string): string[] {
  const chartYamlPath = path.join(chartPath, "Chart.yaml");
  if (!fs.existsSync(chartYamlPath)) return [];
  const parsed = readYamlFile(chartYamlPath) as ChartFile | null;
  const raw = parsed?.annotations?.["org.agent-ix.tags"];
  if (typeof raw !== "string") return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

function parseChartNamespace(chartPath: string): string {
  const chartYamlPath = path.join(chartPath, "Chart.yaml");
  if (!fs.existsSync(chartYamlPath)) return IX_APPS_NAMESPACE;
  const parsed = readYamlFile(chartYamlPath) as ChartFile | null;
  const raw = parsed?.annotations?.["org.agent-ix.namespace"];
  if (typeof raw !== "string" || raw.trim() === "") return IX_APPS_NAMESPACE;
  return raw.trim();
}

function matchesTagFilters(tags: string[], opts: UpFilterOptions): boolean {
  if (opts.includeTag && !tags.includes(opts.includeTag)) return false;
  if (opts.excludeTag && tags.includes(opts.excludeTag)) return false;
  return true;
}

function makefileHasTargets(repoDir: string, targets: string[]): boolean {
  const makefilePath = path.join(repoDir, "Makefile");
  if (!fs.existsSync(makefilePath)) return false;
  const contents = fs.readFileSync(makefilePath, "utf-8");
  return targets.every((target) =>
    new RegExp(`^${target}\\s*:`, "m").test(contents),
  );
}

function resolveSecretContractDir(repoDir: string, chartPath: string): string {
  if (fs.existsSync(path.join(chartPath, SECRETS_FILENAME))) return chartPath;
  return repoDir;
}

function resolveServiceInstall(
  name: string,
  devDir: string,
  embeddedIn?: string,
): LocalInstall {
  const standaloneDir = path.join(devDir, name);
  let repoDir: string;
  let chartPath: string;

  if (fs.existsSync(standaloneDir)) {
    repoDir = standaloneDir;
    chartPath = path.join(repoDir, "helm");
    ensureDirExists(chartPath, "Local Helm chart not found");
  } else if (embeddedIn) {
    chartPath = path.join(embeddedIn, "helm", name);
    repoDir = chartPath;
    if (!fs.existsSync(chartPath)) {
      throw new Error(`Directory not found: ${standaloneDir}`);
    }
  } else {
    ensureDirExists(standaloneDir, "Directory not found");
    chartPath = path.join(standaloneDir, "helm");
    repoDir = standaloneDir;
  }

  const valuesPath = path.join(chartPath, "values.yaml");
  if (!fs.existsSync(valuesPath)) {
    throw new Error(`Local Helm values not found: ${valuesPath}`);
  }
  return {
    name,
    chartPath,
    valuesFiles: [valuesPath],
    repoDir,
    secretContractDir: resolveSecretContractDir(repoDir, chartPath),
    dependencyUpdate: shouldDependencyUpdate(chartPath),
    tags: parseChartTags(chartPath),
    namespace: parseChartNamespace(chartPath),
  };
}

function parseLocalAppDependencies(chartPath: string): string[] {
  const parsed = readYamlFile(chartPath) as ChartFile | null;
  const deps = parsed?.dependencies ?? [];
  return deps
    .filter((dep): dep is { name: string } => typeof dep.name === "string")
    .map((dep) => dep.name);
}

function buildAppChildOverrideFile(
  tmpDir: string,
  appValuesPath: string,
  childName: string,
): string | null {
  const parsed = (readYamlFile(appValuesPath) as Record<string, unknown>) ?? {};
  const child = parsed[childName];
  const hasChild = child != null && typeof child === "object";
  const hasGlobal = parsed.global !== undefined;

  if (!hasChild && !hasGlobal) return null;

  const generated = {
    ...(hasGlobal ? { global: parsed.global } : {}),
    ...(hasChild ? (child as Record<string, unknown>) : {}),
  };
  const filePath = path.join(tmpDir, `${childName}.values.yaml`);
  fs.writeFileSync(filePath, stringifyYaml(generated), "utf-8");
  return filePath;
}

function resolveAppInstalls(
  appName: string,
  devDir: string,
  tmpDir: string,
  opts: UpFilterOptions,
): { appRepoDir: string; installs: LocalInstall[] } {
  const repoDir = path.join(devDir, appName);
  const chartPath = path.join(repoDir, "helm", appName);
  ensureDirExists(repoDir, "Directory not found");
  ensureDirExists(chartPath, "Local app Helm chart not found");

  const chartYamlPath = path.join(chartPath, "Chart.yaml");
  if (!fs.existsSync(chartYamlPath)) {
    throw new Error(`App chart metadata not found: ${chartYamlPath}`);
  }

  const appValuesPath = resolveProfileValuesPath(chartPath);
  if (!fs.existsSync(appValuesPath)) {
    throw new Error(`App values file not found: ${appValuesPath}`);
  }

  return {
    appRepoDir: repoDir,
    installs: parseLocalAppDependencies(chartYamlPath)
      .map((depName) => {
        const serviceInstall = resolveServiceInstall(depName, devDir, repoDir);
        if (!matchesTagFilters(serviceInstall.tags, opts)) return null;
        const overrideFile = buildAppChildOverrideFile(
          tmpDir,
          appValuesPath,
          depName,
        );
        return {
          ...serviceInstall,
          valuesFiles: overrideFile
            ? [...serviceInstall.valuesFiles, overrideFile]
            : serviceInstall.valuesFiles,
        };
      })
      .filter((install): install is LocalInstall => install !== null),
  };
}

function resolveLocalInstalls(
  name: string,
  devDir: string,
  tmpDir: string,
  opts: UpFilterOptions,
): { secretRepoDirs: string[]; installs: LocalInstall[] } {
  const appChartPath = path.join(devDir, name, "helm", name, "Chart.yaml");
  if (fs.existsSync(appChartPath)) {
    const app = resolveAppInstalls(name, devDir, tmpDir, opts);
    return {
      secretRepoDirs: [
        app.appRepoDir,
        ...app.installs.map((install) => install.secretContractDir),
      ],
      installs: app.installs,
    };
  }
  const install = resolveServiceInstall(name, devDir);
  if (!matchesTagFilters(install.tags, opts)) {
    return { secretRepoDirs: [install.secretContractDir], installs: [] };
  }
  return { secretRepoDirs: [install.secretContractDir], installs: [install] };
}

function buildLocalHelmArgs(
  install: LocalInstall,
  config: IxConfig,
  imageTag: string,
): string[] {
  const args = [
    "upgrade",
    "--install",
    install.name,
    install.chartPath,
    "--namespace",
    install.namespace,
    "--create-namespace",
    "--take-ownership",
  ];

  if (install.dependencyUpdate) args.push("--dependency-update");
  for (const valuesFile of install.valuesFiles) args.push("-f", valuesFile);
  args.push("--set-string", `global.imageTag=${imageTag}`);
  args.push(...buildGlobalSetArgs(config));
  args.push(...buildHelmSetArgs(resolveCatalog()));
  return args;
}

export function initialSourceRows(
  installs: { name: string }[],
): ServiceRow<SourcePhase>[] {
  return createPhaseRows(
    installs.map((install) => ({
      name: install.name,
      displayName: `${install.name} ${pc.dim("source")}`,
    })),
    SOURCE_PHASES,
  );
}

export interface SourceModePlan {
  installs: LocalInstall[];
  secretContracts: NonNullable<
    Awaited<ReturnType<typeof loadSecretContract>>
  >[];
  requiresRegistryAuth: boolean;
  imageTag: string;
  tmpDir: string;
  dispose: () => void;
}

export async function planSourceModeUp(
  services: string[],
  config: IxConfig,
  tagOverride: string | null,
  devDir: string,
  opts: UpFilterOptions,
): Promise<SourceModePlan> {
  const imageTag = tagOverride ?? config.imageTag;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-local-source-"));
  try {
    const plans = services.map((service) =>
      resolveLocalInstalls(service, devDir, tmpDir, opts),
    );
    const rawInstalls = plans.flatMap((plan) => plan.installs);
    const override = opts.namespaceOverride?.trim();
    const namespaced = override
      ? rawInstalls.map((i) => ({ ...i, namespace: override }))
      : rawInstalls;
    const installs = opts.refresh
      ? namespaced.map((i) => ({ ...i, dependencyUpdate: true }))
      : namespaced;
    if (installs.length === 0) {
      throw new Error("No local installs matched the requested tag filters.");
    }
    const requiresRegistryAuth = installs.some(
      (install) => install.dependencyUpdate,
    );
    const secretRepoDirs = [
      ...new Set(plans.flatMap((plan) => plan.secretRepoDirs)),
    ];
    const secretContracts = (
      await Promise.all(
        secretRepoDirs.map((repoDir) => loadSecretContract(repoDir)),
      )
    ).filter(
      (contract): contract is NonNullable<typeof contract> => contract !== null,
    );

    return {
      installs,
      secretContracts,
      requiresRegistryAuth,
      imageTag,
      tmpDir,
      dispose: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
}

export async function runSourceModePipeline(
  plan: SourceModePlan,
  config: IxConfig,
  opts: UpFilterOptions,
  emit: (services: ServiceRow<SourcePhase>[]) => void,
): Promise<SourceModeResult> {
  const rows = new PhaseRows(
    plan.installs.map((install) => ({
      name: install.name,
      displayName: `${install.name} ${pc.dim("source")}`,
    })),
    SOURCE_PHASES,
    emit,
  );
  const failures: string[] = [];
  const installNamespaces = [...new Set(plan.installs.map((i) => i.namespace))];

  for (const ns of installNamespaces) await ensureNamespace(ns);

  for (const install of plan.installs) {
    rows.setPhase(install.name, "secrets", "running", "checking secrets");
  }
  for (const contract of plan.secretContracts) {
    const matched = plan.installs.find(
      (i) => i.secretContractDir === contract.repoDir,
    );
    const namespace = matched?.namespace ?? IX_APPS_NAMESPACE;
    try {
      await applySecretContract(contract, namespace);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failed = matched
        ? [matched]
        : plan.installs.filter((install) => install.namespace === namespace);
      for (const install of failed) {
        rows.setError(install.name, "secrets", msg);
      }
      throw err;
    }
  }
  for (const install of plan.installs) {
    rows.setPhase(install.name, "secrets", "done");
  }

  if (plan.requiresRegistryAuth) {
    for (const install of plan.installs) {
      rows.setPhase(install.name, "install", "queued", "helm registry login");
    }
    const token = await resolveGhcrToken(false);
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
      { input: token, all: true },
    );
    for (const install of plan.installs) {
      if (install.dependencyUpdate) {
        rows.setPhase(install.name, "install", "pending");
      }
    }
  }

  for (const install of plan.installs) {
    let phase: SourcePhase = "build";
    try {
      const canBuild = makefileHasTargets(install.repoDir, [
        "build",
        "kind-load",
      ]);
      if (canBuild) {
        rows.setPhase(install.name, "build", "running", "make build");
        await execa("make", ["build"], { cwd: install.repoDir, all: true });
        rows.setPhase(install.name, "build", "running", "make kind-load");
        await execa("make", ["kind-load"], {
          cwd: install.repoDir,
          all: true,
        });
      }
      rows.setPhase(install.name, "build", "done");

      phase = "install";
      rows.setPhase(install.name, "install", "running", "helm upgrade");
      await execa("helm", buildLocalHelmArgs(install, config, plan.imageTag), {
        all: true,
      });
      rows.setPhase(install.name, "install", "running", "rollout restart");
      await execa(
        "kubectl",
        [
          "rollout",
          "restart",
          `deployment/${install.name}`,
          "-n",
          install.namespace,
        ],
        { all: true },
      );
      rows.setPhase(install.name, "install", "done");

      phase = "ready";
      rows.setPhase(install.name, "ready", "running", "checking rollout");
      await waitForRollout(
        install.name,
        install.namespace,
        config.rolloutTimeoutSeconds,
        undefined,
        `app.kubernetes.io/part-of=${install.name}`,
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
  }

  return {
    failures,
    urls: plan.installs.map(
      (install) => `https://${install.name}.${config.internalBaseDomain}`,
    ),
  };
}
