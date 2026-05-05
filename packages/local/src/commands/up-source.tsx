import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import pc from "picocolors";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { IxConfig } from "../config.js";
import { IX_APPS_NAMESPACE, buildGlobalSetArgs } from "../config.js";
import { resolveGhcrToken } from "../credentials.js";
import {
  buildHelmSetArgs,
  resolveCatalog,
  resolveProfile,
} from "../host-mounts.js";
import {
  SECRETS_FILENAME,
  applySecretContract,
  loadSecretContract,
} from "../local-secrets.js";
import { ensureNamespace } from "../namespaces.js";
import { waitForRollout } from "../rollout.js";
import React from "react";
import { Listing, Note, renderStatic } from "@agent-ix/ix-ui-cli";

/**
 * Resolve the values overlay file for an app chart, profile-aware.
 * Lookup order: values-${IX_PROFILE}.yaml → values-local.yaml → values.yaml
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
  /** Target Kubernetes namespace, resolved via the four-tier name fallback. */
  namespace: string;
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
  /** Deploy-time namespace override; wins over chart annotation. */
  namespaceOverride?: string;
  /**
   * FR-030: when true, force `helm dependency update` for every install
   * regardless of whether subcharts are already vendored locally.
   */
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
  if (!fs.existsSync(makefilePath)) {
    return false;
  }
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

  if (install.dependencyUpdate) {
    args.push("--dependency-update");
  }

  for (const valuesFile of install.valuesFiles) {
    args.push("-f", valuesFile);
  }

  args.push("--set-string", `global.imageTag=${imageTag}`);
  args.push(...buildGlobalSetArgs(config));
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
  const header = `ix local up · ${services.join(", ")} · source`;

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
    // FR-030: --refresh forces dependency update on every install.
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

    const failures: string[] = [];
    const installNamespaces = [...new Set(installs.map((i) => i.namespace))];

    // Prepare namespaces.
    for (const ns of installNamespaces) {
      await ensureNamespace(ns);
    }

    // Apply repo secrets.
    for (const contract of secretContracts) {
      const matched = installs.find(
        (i) => i.secretContractDir === contract.repoDir,
      );
      const namespace = matched?.namespace ?? IX_APPS_NAMESPACE;
      await applySecretContract(contract, namespace);
    }

    // Authenticate Helm registry once if any install needs dependency updates.
    if (requiresRegistryAuth) {
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
        { input: token, stdio: ["pipe", "inherit", "inherit"] },
      );
    }

    // Deploy each install. Inherit stdio so helm/make/kubectl progress
    // streams directly; the final-state listing is rendered after the loop.
    for (const install of installs) {
      try {
        const canBuild = makefileHasTargets(install.repoDir, [
          "build",
          "kind-load",
        ]);
        if (canBuild) {
          for (const target of ["build", "kind-load"]) {
            await execa("make", [target], {
              cwd: install.repoDir,
              stdio: "inherit",
            });
          }
        }

        await execa(
          "helm",
          buildLocalHelmArgs(install, config, imageTag),
          { stdio: "inherit" },
        );

        await execa(
          "kubectl",
          [
            "rollout",
            "restart",
            `deployment/${install.name}`,
            "-n",
            install.namespace,
          ],
          { stdio: "inherit" },
        );

        await waitForRollout(
          install.name,
          install.namespace,
          config.rolloutTimeoutSeconds,
          undefined,
          `app.kubernetes.io/part-of=${install.name}`,
        );
      } catch (err) {
        if (!opts.continueOnError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${install.name}: ${msg}`);
      }
    }

    const urls = installs.map(
      (i) => `https://${i.name}.${config.internalBaseDomain}`,
    );

    if (failures.length > 0) {
      await renderStatic(
        <Listing
          header={header}
          status="passed"
          tail={`Deployed from local source with failures: ${failures.join("; ")}`}
          tailVariant="warn"
        />,
      );
    } else {
      await renderStatic(
        <Listing header={header} status="passed" tail="Deployed from local source.">
          {urls.map((u) => (
            <Note key={u}>{u}</Note>
          ))}
        </Listing>,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={header}
        status="failed"
        tail={`Failed to deploy from local source: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
