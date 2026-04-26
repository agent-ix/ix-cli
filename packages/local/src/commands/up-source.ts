import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { Listr } from "listr2";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { IxConfig } from "../config.js";
import { resolveGhcrToken } from "../credentials.js";
import { buildHelmSetArgs, resolveCatalog } from "../host-mounts.js";
import { applySecretContract, loadSecretContract } from "../local-secrets.js";
import { waitForRollout } from "../rollout.js";

interface LocalInstall {
  name: string;
  chartPath: string;
  valuesFiles: string[];
  repoDir: string;
  dependencyUpdate: boolean;
  tags: string[];
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
  if (!fs.existsSync(chartsDir)) {
    return false;
  }

  if (fs.existsSync(path.join(chartsDir, dep.name))) {
    return true;
  }

  if (typeof dep.version === "string" && dep.version.trim() !== "") {
    return fs.existsSync(
      path.join(chartsDir, `${dep.name}-${dep.version}.tgz`),
    );
  }

  return false;
}

function shouldDependencyUpdate(chartPath: string): boolean {
  const chartYamlPath = path.join(chartPath, "Chart.yaml");
  if (!fs.existsSync(chartYamlPath)) {
    return false;
  }

  const parsed = readYamlFile(chartYamlPath) as ChartFile | null;
  const deps = (parsed?.dependencies ?? []).filter(
    (dep): dep is { name: string; version?: unknown } =>
      typeof dep.name === "string" && dep.name.trim() !== "",
  );

  if (deps.length === 0) {
    return false;
  }

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

function matchesTagFilters(tags: string[], opts: UpFilterOptions): boolean {
  if (opts.includeTag && !tags.includes(opts.includeTag)) return false;
  if (opts.excludeTag && tags.includes(opts.excludeTag)) return false;
  return true;
}

function makefileHasTargets(repoDir: string, targets: string[]): boolean {
  const makefilePath = path.join(repoDir, "Makefile");
  if (!fs.existsSync(makefilePath)) {
    return false;
  }
  const contents = fs.readFileSync(makefilePath, "utf-8");
  return targets.every((target) =>
    new RegExp(`^${target}\\s*:`, "m").test(contents),
  );
}

function resolveServiceInstall(name: string, devDir: string): LocalInstall {
  const repoDir = path.join(devDir, name);
  const chartPath = path.join(repoDir, "helm");
  ensureDirExists(repoDir, "Directory not found");
  ensureDirExists(chartPath, "Local Helm chart not found");
  const valuesPath = path.join(chartPath, "values.yaml");
  if (!fs.existsSync(valuesPath)) {
    throw new Error(`Local Helm values not found: ${valuesPath}`);
  }
  return {
    name,
    chartPath,
    valuesFiles: [valuesPath],
    repoDir,
    dependencyUpdate: shouldDependencyUpdate(chartPath),
    tags: parseChartTags(chartPath),
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
): string {
  const parsed = (readYamlFile(appValuesPath) as Record<string, unknown>) ?? {};
  const child = parsed[childName];
  if (!child || typeof child !== "object") {
    throw new Error(
      `App values file '${appValuesPath}' does not define overrides for '${childName}'`,
    );
  }

  const generated = {
    ...(parsed.global !== undefined ? { global: parsed.global } : {}),
    ...(child as Record<string, unknown>),
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

  const appValuesPath = fs.existsSync(path.join(chartPath, "values-local.yaml"))
    ? path.join(chartPath, "values-local.yaml")
    : path.join(chartPath, "values.yaml");
  if (!fs.existsSync(appValuesPath)) {
    throw new Error(`App values file not found: ${appValuesPath}`);
  }

  return {
    appRepoDir: repoDir,
    installs: parseLocalAppDependencies(chartYamlPath)
      .map((depName) => {
        const serviceInstall = resolveServiceInstall(depName, devDir);
        if (!matchesTagFilters(serviceInstall.tags, opts)) return null;
        const overrideFile = buildAppChildOverrideFile(
          tmpDir,
          appValuesPath,
          depName,
        );
        return {
          ...serviceInstall,
          valuesFiles: [...serviceInstall.valuesFiles, overrideFile],
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
        ...app.installs.map((install) => install.repoDir),
      ],
      installs: app.installs,
    };
  }
  const install = resolveServiceInstall(name, devDir);
  if (!matchesTagFilters(install.tags, opts)) {
    return { secretRepoDirs: [install.repoDir], installs: [] };
  }
  return { secretRepoDirs: [install.repoDir], installs: [install] };
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
    "default",
    "--take-ownership",
  ];

  if (install.dependencyUpdate) {
    args.push("--dependency-update");
  }

  for (const valuesFile of install.valuesFiles) {
    args.push("-f", valuesFile);
  }

  args.push(
    "--set-string",
    `global.imageTag=${imageTag}`,
    "--set-string",
    `global.imageRegistry=${config.imageRegistry}`,
    "--set-string",
    `global.internalBaseDomain=${config.internalBaseDomain}`,
  );

  if (config.enableExternalHost && config.externalBaseDomain) {
    args.push(
      "--set-string",
      "global.enableExternalHost=true",
      "--set-string",
      `global.externalBaseDomain=${config.externalBaseDomain}`,
    );
  }
  // FR-014: inject host-mount catalog on every install.
  args.push(...buildHelmSetArgs(resolveCatalog()));

  return args;
}

export async function runSourceModeUp(
  services: string[],
  config: IxConfig,
  tagOverride: string | null,
  devDir: string,
  opts: UpFilterOptions = {},
): Promise<void> {
  p.intro(pc.bgCyan(pc.black(` ix-local up (source mode) `)));

  const imageTag = tagOverride ?? config.imageTag;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-local-source-"));

  try {
    const plans = services.map((service) =>
      resolveLocalInstalls(service, devDir, tmpDir, opts),
    );
    const installs = plans.flatMap((plan) => plan.installs);
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

    const failures: string[] = [];
    const tasks = new Listr(
      [
        ...secretContracts.map((contract) => ({
          title: `Apply repo secrets: ${pc.cyan(path.basename(contract.repoDir))}`,
          task: async (_ctx: unknown, task: { output: string }) => {
            await applySecretContract(contract, (line) => {
              task.output = line;
            });
          },
        })),
        ...(requiresRegistryAuth
          ? [
              {
                title: "Authenticate Helm registry",
                task: async (_ctx: unknown, task: { output: string }) => {
                  const token =
                    config.ghcrToken?.trim() || (await resolveGhcrToken(false));
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
                    { input: token, all: true },
                  );
                  subprocess.all?.on("data", (chunk) => {
                    const line = chunk.toString().trim();
                    if (line) task.output = line;
                  });
                  await subprocess;
                },
              },
            ]
          : []),
        ...installs.map((install) => ({
          title: `Deploy ${pc.cyan(install.name)} from local chart`,
          task: async (_ctx: unknown, task: { output: string }) => {
            try {
              const canBuild = makefileHasTargets(install.repoDir, [
                "build",
                "kind-load",
              ]);
              if (canBuild) {
                for (const target of ["build", "kind-load"]) {
                  const subprocess = execa("make", [target], {
                    cwd: install.repoDir,
                    all: true,
                  });
                  subprocess.all?.on("data", (chunk) => {
                    const line = chunk.toString().trim();
                    if (line) task.output = line;
                  });
                  await subprocess;
                }
              }

              const helmSubprocess = execa(
                "helm",
                buildLocalHelmArgs(install, config, imageTag),
                { all: true },
              );
              helmSubprocess.all?.on("data", (chunk) => {
                const line = chunk.toString().trim();
                if (line) task.output = line;
              });
              await helmSubprocess;

              const restartSubprocess = execa(
                "kubectl",
                [
                  "rollout",
                  "restart",
                  `deployment/${install.name}`,
                  "-n",
                  "default",
                ],
                { all: true },
              );
              restartSubprocess.all?.on("data", (chunk) => {
                const line = chunk.toString().trim();
                if (line) task.output = line;
              });
              await restartSubprocess;

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
        })),
      ],
      {
        concurrent: false,
        exitOnError: !opts.continueOnError,
      },
    );

    await tasks.run();
    const urls = installs.map(
      (i) => `https://${i.name}.${config.internalBaseDomain}`,
    );
    if (failures.length > 0) {
      p.outro(
        pc.yellow(
          `Deployed from local source with failures: ${failures.join("; ")}`,
        ),
      );
    } else {
      p.outro(
        pc.green(
          `Deployed from local source via Helm release(s): ${pc.cyan(installs.map((i) => i.name).join(", "))}\n\n  ${urls.map((u) => pc.cyan(pc.underline(u))).join("\n  ")}`,
        ),
      );
    }
  } catch (err) {
    p.outro(
      pc.red(
        `Failed to deploy from local source: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
