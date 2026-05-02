import { makeListr, startListing } from "@agent-ix/ix-ui-cli";
import { execa } from "execa";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./config.js";
import { resolveDeployableNamespace } from "./discovery.js";
import { runImageModeUp } from "./commands/up-image.js";
import { runSourceModeUp } from "./commands/up-source.js";
import { loadRegistry, findDeployable } from "./registry.js";
import { resolveGhcrToken } from "./credentials.js";

// Re-export everything needed by apps/ix command files.
export {
  loadConfig,
  loadClusterConfig,
  type IxConfig,
  type ClusterConfig,
} from "./config.js";
export {
  runClusterUp,
  computeEffectiveDeploySet,
} from "./commands/cluster-up.js";
export { runClusterDown } from "./commands/cluster-down.js";
export { runClusterStatus } from "./commands/cluster-status.js";
export { runInitCluster } from "./commands/init-cluster.js";
export { runList } from "./commands/list.js";
export { loadRegistry, findDeployable } from "./registry.js";
export { resolveGhcrToken } from "./credentials.js";
export { runAuthInit } from "./commands/auth-init.js";
export { runAuthResetAdmin } from "./commands/auth-reset-admin.js";
export { runAuthInvite } from "./commands/auth-invite.js";
export { runAuthResetUser } from "./commands/auth-reset-user.js";
export {
  runAuthConfigEmailEnable,
  runAuthConfigEmailDisable,
  runAuthConfigEmailShow,
  runAuthConfigEmailTest,
  runAuthConfigPasswordResetSet,
  runAuthConfigPasswordResetShow,
  runAuthConfigSocialAdd,
  runAuthConfigSocialRemove,
  runAuthConfigSocialList,
  runAuthConfigSocialShow,
  runAuthConfigRegistrationSet,
  runAuthConfigRegistrationShow,
} from "./commands/auth-config.js";

// H4: FR-001-CON-1: DEV_DIR overridable via env (default ~/dev, not hardcoded user path)
export const DEV_DIR = process.env.IX_DEV_DIR ?? path.join(os.homedir(), "dev");

function deployableMatchesTags(
  deployable: { tags: string[] },
  opts: { includeTag?: string; excludeTag?: string },
): boolean {
  if (opts.includeTag && !deployable.tags.includes(opts.includeTag)) {
    return false;
  }
  if (opts.excludeTag && deployable.tags.includes(opts.excludeTag)) {
    return false;
  }
  return true;
}

export async function executeLocals(services: string[], action: "up" | "down") {
  const list = startListing(`ix local ${action}`);
  list.commit();

  // M6: If user passes both named services and "all", that's a conflicting
  // intent — error rather than silently dropping named services.
  if (
    services.length > 1 &&
    services.some((s) => s === "all") &&
    services.some((s) => s !== "all")
  ) {
    throw new Error(
      'Cannot mix "all" with named services. Use "all" alone or list individual services.',
    );
  }

  if (services.length === 0 || services.includes("all")) {
    services = ["all"];
  }

  if (action === "up" && services.some((svc) => svc !== "all")) {
    throw new Error(
      "Named source deploys are handled by the Helm-native source-mode runner. Use runUp(..., { fromSource: true }) instead of executeLocals(..., 'up').",
    );
  }

  const tasks = makeListr(
    services.map((svc) => {
      const isGlobal = svc === "all";
      const serviceDir = isGlobal
        ? path.join(DEV_DIR, "local")
        : path.join(DEV_DIR, svc);

      const cmd = isGlobal
        ? action === "up"
          ? "up"
          : "down"
        : action === "up"
          ? "deploy"
          : "halt";

      return {
        title: `${action === "up" ? "Starting" : "Stopping"} ${pc.cyan(svc)}`,
        task: async (ctx, task) => {
          if (!fs.existsSync(serviceDir)) {
            // FR-004-AC-1: descriptive directory error
            if (!isGlobal && action === "up") {
              throw new Error(
                `Directory not found: ${serviceDir}. ` +
                  `Drop --from-source to deploy the latest stable build from the registry.`,
              );
            }
            throw new Error(`Directory not found: ${serviceDir}`);
          }

          const subprocess = execa("make", [cmd], {
            cwd: serviceDir,
            all: true,
          });

          subprocess.all?.on("data", (chunk) => {
            let logLine = chunk.toString().trim();
            if (logLine) {
              const lines = logLine.split("\n").filter(Boolean);
              if (lines.length > 0) {
                task.output = lines[lines.length - 1];
              }
            }
          });

          await subprocess;
        },
      };
    }),
    { concurrent: false },
  );

  try {
    await tasks.run();
    list.success(
      `Successfully ${action === "up" ? "started" : "stopped"} everything.`,
    );
  } catch (err) {
    // FR-003-AC-3: failure outro
    list.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * FR-008: top-level dispatcher for `ix local up`. Default = image mode from
 * registry; `--from-source` opts into local Helm chart deployment.
 *
 * Exported for unit tests that need to assert the dispatch logic without
 * routing through commander.
 */
export async function runUp(
  servicesArgs: string[],
  opts: {
    fromSource?: boolean;
    tag?: string;
    namespace?: string;
    includeTag?: string;
    excludeTag?: string;
    continueOnError?: boolean;
    latest?: boolean;
    refresh?: boolean;
  } = {},
): Promise<void> {
  const services = servicesArgs.length > 0 ? servicesArgs : ["all"];

  if (opts.fromSource) {
    if (services.includes("all")) {
      await executeLocals(services, "up");
      return;
    }
    const config = loadConfig();
    await runSourceModeUp(services, config, opts.tag ?? null, DEV_DIR, {
      includeTag: opts.includeTag,
      excludeTag: opts.excludeTag,
      continueOnError: opts.continueOnError,
      namespaceOverride: opts.namespace,
      refresh: opts.refresh,
    });
    return;
  }

  // FR-008-AC-6: "all" without --from-source is rejected.
  if (services.includes("all")) {
    throw new Error(
      '"all" requires --from-source. For image-mode deploys, list deployables explicitly (see `ix local list`).',
    );
  }
  const config = loadConfig();
  const registry = await loadRegistryForCommand(config);
  for (const svc of services) {
    const deployable = findDeployable(registry, svc);
    const filteredExpander =
      deployable.role === "app"
        ? async () => {
            const { defaultExpandApp } = await import("./commands/up-image.js");
            const { resolveDeployableNamespace } =
              await import("./discovery.js");
            const installs = await defaultExpandApp(deployable, config);
            return installs
              .filter((install) => {
                const child = registry.find((d) => d.name === install.name);
                if (!child) return true;
                return deployableMatchesTags(child, opts);
              })
              .map((install) => {
                const child = registry.find((d) => d.name === install.name);
                const next = { ...install };
                if (child) {
                  next.namespace = resolveDeployableNamespace(child);
                  if (opts.latest) next.chartVersion = child.version;
                }
                return next;
              });
          }
        : undefined;
    if (deployable.role !== "app" && !deployableMatchesTags(deployable, opts)) {
      throw new Error(
        `Deployable '${deployable.name}' does not match the requested tag filters.`,
      );
    }
    await runImageModeUp(
      deployable,
      config,
      opts.tag ?? null,
      filteredExpander,
      {
        continueOnError: opts.continueOnError,
        namespaceOverride: opts.namespace,
      },
      DEV_DIR,
    );
  }
}

export async function runDown(
  servicesArgs: string[],
  opts: { fromSource?: boolean } = {},
): Promise<void> {
  const services = servicesArgs.length > 0 ? servicesArgs : ["all"];

  if (opts.fromSource) {
    await executeLocals(services, "down");
    return;
  }

  if (services.includes("all")) {
    throw new Error(
      '"all" requires --from-source. For image-mode teardown, list deployables explicitly (see `ix local list`).',
    );
  }

  const config = loadConfig();
  const registry = await loadRegistryForCommand(config);
  const releases: { name: string; namespace: string }[] = [];
  for (const svc of services) {
    const deployable = findDeployable(registry, svc);
    if (deployable.role === "app") {
      const { defaultExpandApp } = await import("./commands/up-image.js");
      const installs = await defaultExpandApp(deployable, config);
      for (const install of installs)
        releases.push({ name: install.name, namespace: install.namespace });
    } else {
      releases.push({
        name: deployable.name,
        namespace: resolveDeployableNamespace(deployable),
      });
    }
  }

  const list = startListing(
    `ix local down · ${services.join(", ")} · ${config.helmChartRegistry}`,
  );
  list.commit();
  const tasks = makeListr(
    releases.map(({ name, namespace }) => ({
      title: `Uninstall ${pc.cyan(name)} (${namespace})`,
      task: async (_ctx: unknown, task: { output: string }) => {
        const subprocess = execa(
          "helm",
          ["uninstall", name, "--namespace", namespace, "--ignore-not-found"],
          { all: true },
        );
        subprocess.all?.on("data", (chunk) => {
          const line = chunk.toString().trim();
          if (line) task.output = line;
        });
        await subprocess;
      },
    })),
    { concurrent: false },
  );
  await tasks.run();
  list.success(`Uninstalled: ${releases.map((r) => r.name).join(", ")}`);
}

export async function runRefresh(
  config: import("./config.js").IxConfig,
): Promise<void> {
  const list = startListing("ix local refresh");
  list.commit();
  try {
    const token = config.ghcrToken?.trim() || (await resolveGhcrToken(false));
    const reg = await loadRegistry({
      org: config.org,
      githubToken: token,
      refresh: true,
    });
    list.success(`Refreshed registry: ${reg.length} deployable(s).`);
  } catch (err) {
    list.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

async function loadRegistryForCommand(config: import("./config.js").IxConfig) {
  const token = config.ghcrToken?.trim() || (await resolveGhcrToken(false));
  const list = startListing(`ix local · resolving registry · ${config.org}`);
  try {
    return await loadRegistry({ org: config.org, githubToken: token });
  } finally {
    list.stop();
  }
}
