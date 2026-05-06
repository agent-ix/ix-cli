import { Item, Listing, Note, renderStatic } from "@agent-ix/ix-ui-cli";
import { execa } from "execa";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./config.js";
import { resolveDeployableNamespace } from "./discovery.js";
import { runImageModeUp } from "./commands/up-image.js";
import { runSourceModeUp } from "./commands/up-source.js";
import {
  loadRegistry,
  findDeployable,
  readCachedDeployables,
} from "./registry.js";
import { resolveGhcrToken } from "./credentials.js";
import { diffRegistry, formatRefreshChange } from "./refresh-diff.js";

// Schema + plugin metadata (consumed by apps/ix init hook).
export {
  LocalConfigSchema,
  LocalEnvBindings,
  LocalSecretsSchema,
  LOCAL_PLUGIN_ID,
  type LocalConfig,
} from "./schema.js";

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
export { runAuthUninvite } from "./commands/auth-uninvite.js";
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
  const header = `ix local ${action}`;

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

  try {
    for (const svc of services) {
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

      if (!fs.existsSync(serviceDir)) {
        if (!isGlobal && action === "up") {
          throw new Error(
            `Directory not found: ${serviceDir}. ` +
              `Drop --from-source to deploy the latest stable build from the registry.`,
          );
        }
        throw new Error(`Directory not found: ${serviceDir}`);
      }

      // Inherit stdio so make output streams directly. The final-state
      // listing is rendered after the loop completes (success or fail).
      await execa("make", [cmd], { cwd: serviceDir, stdio: "inherit" });
    }

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={`Successfully ${action === "up" ? "started" : "stopped"} everything.`}
      />,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={header}
        status="failed"
        tail={`Failed: ${msg}`}
        tailVariant="error"
      />,
    );
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
  const seen = new Set<string>();
  const pushRelease = (name: string, namespace: string) => {
    const key = `${namespace}/${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    releases.push({ name, namespace });
  };
  for (const svc of services) {
    const deployable = findDeployable(registry, svc);
    if (deployable.role === "app") {
      // FR-031: app-role deployables install as a single umbrella Helm
      // release named after the deployable. Uninstall that release first;
      // Helm cleans up all subchart resources as part of it.
      const umbrellaNs = resolveDeployableNamespace(deployable);
      pushRelease(deployable.name, umbrellaNs);
      // Transitional cleanup: prior versions of ix-cli installed each
      // subchart as its own Helm release. Include those names too so
      // users mid-migration aren't left with orphan releases. The down
      // task is gated by --ignore-not-found, so missing releases no-op.
      const { defaultExpandApp } = await import("./commands/up-image.js");
      const installs = await defaultExpandApp(deployable, config);
      for (const install of installs) {
        pushRelease(install.name, install.namespace);
      }
    } else {
      pushRelease(deployable.name, resolveDeployableNamespace(deployable));
    }
  }

  const header = `ix local down · ${services.join(", ")} · ${config.helmChartRegistry}`;

  try {
    for (const { name, namespace } of releases) {
      await execa(
        "helm",
        ["uninstall", name, "--namespace", namespace, "--ignore-not-found"],
        { stdio: "inherit" },
      );
    }

    // Delete PVCs in every namespace we just uninstalled from so that
    // Retain-policy PVs don't get stuck in Released state on the next
    // `ix local up` cycle.
    const uninstalledNamespaces = [
      ...new Set(releases.map((r) => r.namespace)),
    ];
    for (const ns of uninstalledNamespaces) {
      await execa(
        "kubectl",
        ["delete", "pvc", "--all", "-n", ns, "--ignore-not-found"],
        { stdio: "inherit" },
      );
    }

    // Patch Released PVs → Available
    const { stdout } = await execa("kubectl", [
      "get",
      "pv",
      "-o",
      "jsonpath={range .items[?(@.status.phase=='Released')]}{.metadata.name}{'\\n'}{end}",
    ]);
    const pvNames = stdout.split("\n").filter(Boolean);
    for (const pv of pvNames) {
      await execa("kubectl", [
        "patch",
        "pv",
        pv,
        "--type=json",
        `-p=[{"op":"remove","path":"/spec/claimRef"}]`,
      ]);
    }

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={`Uninstalled: ${releases.map((r) => r.name).join(", ")}`}
      >
        {pvNames.length > 0 && (
          <Note>{`Cleared claimRef on ${pvNames.length} Released PV(s).`}</Note>
        )}
      </Listing>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={header}
        status="failed"
        tail={`Failed: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  }
}

export async function runRefresh(
  config: import("./config.js").IxConfig,
): Promise<void> {
  const header = "ix local refresh";
  try {
    const token = await resolveGhcrToken(false);
    const prior = readCachedDeployables(config.org);
    const reg = await loadRegistry({
      org: config.org,
      githubToken: token,
      refresh: true,
    });
    const changes = diffRegistry(prior, reg);

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={
          changes.length === 0
            ? `Registry up to date · ${reg.length} deployable(s).`
            : `Refreshed: ${changes.length} chart(s) updated.`
        }
      >
        {changes.map((change, i) => (
          <Item key={i} name={formatRefreshChange(change)} />
        ))}
      </Listing>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={header}
        status="failed"
        tail={`Failed: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  }
}

async function loadRegistryForCommand(config: import("./config.js").IxConfig) {
  const token = await resolveGhcrToken(false);
  return await loadRegistry({ org: config.org, githubToken: token });
}
