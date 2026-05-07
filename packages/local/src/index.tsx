import type React from "react";
import {
  ConfirmPrompt,
  Item,
  Listing,
  Note,
  render,
  renderStatic,
  useEffect,
  useRenderResult,
  useState,
} from "@agent-ix/ix-ui-cli";
import { execa } from "execa";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./config.js";
import { runImageModeUp } from "./commands/up-image.js";
import { runSourceModeUp } from "./commands/up-source.js";
import {
  loadRegistry,
  findDeployable,
  readCachedDeployables,
} from "./registry.js";
import { resolveGhcrToken } from "./credentials.js";
import { diffRegistry, formatRefreshChange } from "./refresh-diff.js";
import { ensureClusterCertCoversHosts } from "./cluster-cert.js";

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
export { runClusterStop } from "./commands/cluster-stop.js";
export { runClusterStart } from "./commands/cluster-start.js";
export { runClusterStatus } from "./commands/cluster-status.js";
export { runInitCluster } from "./commands/init-cluster.js";
export { runClusterRefreshCert } from "./commands/cluster-refresh-cert.js";
export { ensureClusterCertCoversHosts } from "./cluster-cert.js";
export {
  runTunnelUpCommand,
  runTunnelDownCommand,
  runTunnelStatusCommand,
  runTunnelExposeCommand,
  runTunnelUnexposeCommand,
  runTunnelDomainCommand,
} from "./tunnel/runner.js";
export {
  runTunnelUp,
  runTunnelDown,
  getTunnelStatus,
  TUNNEL_NAMESPACE,
} from "./tunnel/install.js";
export {
  exposeApp,
  unexposeApp,
  deriveHostname,
  buildExposeOverlay,
  buildUnexposeOverlay,
} from "./tunnel/expose.js";
export {
  resolveCloudflareToken,
  requireCloudflareToken,
  firstRunSetup,
  setTunnelBaseDomain,
  TunnelCredentialsError,
} from "./tunnel/credentials.js";
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
 * Verify the cluster TLS cert covers the configured hosts; re-issue
 * if not. Silent on the happy path; renders a single Listing when a
 * refresh is performed, or when the check fails (so the up-flow
 * output isn't stolen by a no-op cert check).
 */
async function ensureCertOrLog(config: {
  hosts: string[];
  certWaitTimeoutSeconds: number;
}): Promise<void> {
  const { hosts } = config;
  try {
    const { refreshed } = await ensureClusterCertCoversHosts(hosts, {
      waitTimeoutSeconds: config.certWaitTimeoutSeconds,
    });
    if (!refreshed) return;
    await renderStatic(
      <Listing
        header="ix local · tls cert"
        status="passed"
        tail={`Re-issued ix-tls for hosts: ${hosts.join(", ")}`}
      />,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header="ix local · tls cert"
        status="failed"
        tail={`Cert check skipped: ${msg}`}
        tailVariant="error"
      />,
    );
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
    await ensureCertOrLog(config);
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
  await ensureCertOrLog(config);
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

async function defaultHaltAllConfirm(count: number): Promise<boolean> {
  let answer: boolean | null = null;
  const Capture: React.FC = () => {
    const { exit } = useRenderResult();
    const [done, setDone] = useState(false);
    useEffect(() => {
      if (done) {
        const t = setTimeout(exit, 0);
        return () => clearTimeout(t);
      }
    }, [done, exit]);
    return (
      <ConfirmPrompt
        message={`Halt all ${count} listed release(s)? This will uninstall every deployable and delete all PVCs in their namespaces.`}
        defaultValue={false}
        onSubmit={(r) => {
          answer = r.ok ? r.value : null;
          setDone(true);
        }}
      />
    );
  };
  await render(<Capture />);
  return answer === true;
}

export async function runDown(
  servicesArgs: string[],
  opts: { fromSource?: boolean; yes?: boolean } = {},
): Promise<void> {
  const services = servicesArgs.length > 0 ? servicesArgs : ["all"];

  if (opts.fromSource) {
    await executeLocals(services, "down");
    return;
  }

  // FR-035-AC-6: mixing "all" with named services is rejected.
  if (
    services.length > 1 &&
    services.includes("all") &&
    services.some((s) => s !== "all")
  ) {
    throw new Error(
      'Cannot mix "all" with named services. Use "all" alone or list individual services.',
    );
  }

  const config = loadConfig();
  const registry = await loadRegistryForCommand(config);
  const isAll = services.includes("all");

  // FR-035-AC-1: image-mode "all" enumerates the registry and resolves
  // every deployable. The resolver is a pure function; runDown only handles
  // I/O around it.
  const { resolveDownReleases } = await import("./commands/halt-resolve.js");
  const { defaultExpandApp } = await import("./commands/up-image.js");
  const releases = await resolveDownReleases(
    services,
    registry,
    config,
    defaultExpandApp,
  );

  const header = `ix local halt · ${services.join(", ")} · ${config.helmChartRegistry}`;

  // FR-035-AC-2/AC-3: for "all" in image mode, preview the releases that
  // will be uninstalled and require explicit confirmation. --yes bypasses.
  if (isAll && !opts.yes) {
    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={`${releases.length} release(s) will be uninstalled.`}
      >
        {releases.map((r) => (
          <Item
            key={`${r.namespace}/${r.name}`}
            name={`${r.namespace}/${r.name}`}
          />
        ))}
      </Listing>,
    );
    const confirmed = await defaultHaltAllConfirm(releases.length);
    if (!confirmed) {
      await renderStatic(
        <Listing
          header={header}
          status="passed"
          tail="Cancelled. No releases uninstalled."
          tailVariant="warn"
        />,
      );
      return;
    }
  }

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
