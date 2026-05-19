/**
 * FR-038 — High-level runners that the `ix tunnel` CLI invokes.
 *
 * These wrap `install.ts` and `expose.ts` with config + registry
 * loading and route output through the shared `Listing` UI so the
 * tunnel commands match the look of the rest of the CLI.
 */

import {
  FlowLine,
  Item,
  Listing,
  Note,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";
import {
  loadConfig,
  loadTunnelConfig,
  updateTunnelExposed,
} from "../config.js";
import { resolveGhcrToken } from "../credentials.js";
import { loadRegistry } from "../registry.js";
import { setTunnelBaseDomain } from "./credentials.js";
import {
  deriveHostname,
  exposeApp,
  unexposeApp,
  type ExposeResult,
} from "./expose.js";
import {
  getTunnelStatus,
  runTunnelDown,
  runTunnelUp,
  TUNNEL_NAMESPACE,
} from "./install.js";

const HEADER_UP = "ix tunnel up";
const HEADER_DOWN = "ix tunnel down";
const HEADER_STATUS = "ix tunnel status";
const HEADER_EXPOSE = "ix tunnel expose";
const HEADER_UNEXPOSE = "ix tunnel unexpose";
const HEADER_DOMAIN = "ix tunnel domain";

export async function runTunnelUpCommand(): Promise<void> {
  const config = loadConfig();
  try {
    const result = await runTunnelUp(config, { requireToken: true });
    await renderStatic(
      <Listing
        header={HEADER_UP}
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`Installing cloudflared in ${blue(TUNNEL_NAMESPACE)}`}</FlowLine>
        }
        tail={
          result.installed
            ? `Cloudflared installed in ${blue(TUNNEL_NAMESPACE)}.`
            : `Skipped · ${result.skippedReason}.`
        }
      >
        <Item name="release" description="cloudflared" />
        <Item name="namespace" description={TUNNEL_NAMESPACE} />
      </Listing>,
    );
    if (result.installed) {
      await reconcileExposedReleases();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={HEADER_UP}
        status="failed"
        tail={msg}
        tailVariant="error"
      />,
    );
    throw err;
  }
}

/**
 * Walk `tunnel.exposed` and reapply each app's overlay. Idempotent
 * (`exposeApp` uses `helm upgrade --reuse-values`), so a release that's
 * already correctly exposed is a no-op. Releases that don't exist yet
 * (operator hasn't run `ix up <app>` since recording intent) get a
 * skip row rather than failing the whole reconcile.
 */
async function reconcileExposedReleases(): Promise<void> {
  const tunnelCfg = loadTunnelConfig();
  const exposedNames = Object.keys(tunnelCfg.exposed);
  if (exposedNames.length === 0) return;

  const { config, registry } = await loadRegistryForTunnel();
  const rows: Array<{
    app: string;
    status: "ok" | "skipped" | "failed";
    detail: string;
  }> = [];
  for (const appName of exposedNames) {
    const entry = tunnelCfg.exposed[appName];
    try {
      const result = await exposeApp(
        appName,
        registry,
        config,
        tunnelCfg.baseDomain,
        { hostname: entry.hostname ?? undefined },
      );
      rows.push({
        app: appName,
        status: "ok",
        detail: `reapplied → ${result.hostsAdded.join(", ")}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // No release yet → operator hasn't installed this app since
      // recording intent. Don't fail the reconcile; report and continue.
      if (/release: not found|No helm release named/i.test(msg)) {
        rows.push({
          app: appName,
          status: "skipped",
          detail: "no release yet — `ix up` will pick up intent",
        });
        continue;
      }
      rows.push({ app: appName, status: "failed", detail: msg });
    }
  }
  const anyFailed = rows.some((r) => r.status === "failed");
  const ok = rows.filter((r) => r.status === "ok").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  await renderStatic(
    <Listing
      header={`${HEADER_UP}: reconcile`}
      status={anyFailed ? "failed" : "passed"}
      variant={anyFailed ? undefined : "flow"}
      pre={
        anyFailed ? undefined : (
          <FlowLine>{`Reconciling ${blue(String(rows.length))} exposed release(s)`}</FlowLine>
        )
      }
      tailVariant={anyFailed ? "error" : undefined}
      tail={`Reconciled ${ok} ok · ${skipped} skipped · ${failed} failed.`}
    >
      {rows.map((r) => (
        <Item
          key={r.app}
          name={r.app}
          description={`${r.status} — ${r.detail}`}
        />
      ))}
    </Listing>,
  );
}

export async function runTunnelDownCommand(): Promise<void> {
  try {
    await runTunnelDown();
    await renderStatic(
      <Listing
        header={HEADER_DOWN}
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`Removing cloudflared from ${blue(TUNNEL_NAMESPACE)}`}</FlowLine>
        }
        tail="Tunnel torn down (idempotent)."
      />,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={HEADER_DOWN}
        status="failed"
        tail={msg}
        tailVariant="error"
      />,
    );
    throw err;
  }
}

export async function runTunnelStatusCommand(): Promise<void> {
  const tunnelCfg = loadTunnelConfig();
  const status = await getTunnelStatus(tunnelCfg.baseDomain);
  const ok = status.installed && status.ready;
  const tail = status.installed
    ? `${status.exposedHosts.length} exposed host(s) under *.${tunnelCfg.baseDomain}.`
    : `cloudflared is not installed. Run \`ix tunnel up\`.`;
  await renderStatic(
    <Listing
      header={HEADER_STATUS}
      status={ok ? "passed" : "failed"}
      tailVariant={ok ? undefined : "warn"}
      tail={tail}
    >
      <Item name="installed" description={status.installed ? "yes" : "no"} />
      <Item name="pod-phase" description={status.podPhase ?? "(none)"} />
      <Item name="base-domain" description={tunnelCfg.baseDomain} />
      <Item
        name="auto-start"
        description={tunnelCfg.autoStart ? "true" : "false"}
      />
      {status.exposedHosts.map((h) => (
        <Item key={h} name="exposed" description={h} />
      ))}
      {status.exposedHosts.length === 0 && status.installed && (
        <Note>
          No app currently exposes a {tunnelCfg.baseDomain} host. Use{" "}
          <Note>{`ix tunnel expose <app>`}</Note>.
        </Note>
      )}
    </Listing>,
  );
}

async function loadRegistryForTunnel() {
  const config = loadConfig();
  const token = await resolveGhcrToken(false);
  const registry = await loadRegistry({ org: config.org, githubToken: token });
  return { config, registry };
}

async function renderExposeResult(
  header: string,
  baseDomain: string,
  result: ExposeResult,
  hostnameOverride: string | null,
): Promise<void> {
  // The release name is NOT the hostname for umbrella apps — the entry
  // subchart's fullname is. Source the tail line from the actual hosts
  // we read back from the rendered Ingress (`result.hostsAdded`),
  // falling back to the explicit override or — last resort — to the
  // release name (only correct for single-service releases).
  const tailHost =
    hostnameOverride ??
    result.hostsAdded[0] ??
    `${result.release}.${baseDomain}`;
  await renderStatic(
    <Listing
      header={header}
      status="passed"
      variant="flow"
      pre={
        <FlowLine>{`Exposing ${blue(result.release)} at ${blue(tailHost)}`}</FlowLine>
      }
      tail={`Tunnel-routed at ${blue(`https://${tailHost}`)}`}
    >
      <Item name="release" description={result.release} />
      <Item name="namespace" description={result.namespace} />
      <Item name="base-domain" description={result.baseDomain} />
      {result.hostsAdded.map((h) => (
        <Item key={h} name="exposed" description={h} />
      ))}
      {result.ingressUrls
        .filter((u) => u.includes(baseDomain))
        .map((u) => (
          <Item key={u} name="url" description={u} />
        ))}
    </Listing>,
  );
}

export async function runTunnelExposeCommand(
  appName: string,
  hostnameOverride: string | null = null,
): Promise<void> {
  try {
    const tunnelCfg = loadTunnelConfig();
    const { config, registry } = await loadRegistryForTunnel();
    const baseDomain = tunnelCfg.baseDomain;
    const hostname = hostnameOverride ?? deriveHostname(appName, baseDomain);
    const result = await exposeApp(appName, registry, config, baseDomain, {
      hostname: hostnameOverride ?? undefined,
    });
    // Persist intent so it survives `ix down` + `ix up` and can be
    // reapplied by future install passes / `ix tunnel up` reconcile.
    updateTunnelExposed((current) => ({
      ...current,
      [result.release]: { hostname: hostnameOverride },
    }));
    await renderExposeResult(HEADER_EXPOSE, baseDomain, result, hostname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={HEADER_EXPOSE}
        status="failed"
        tail={msg}
        tailVariant="error"
      />,
    );
    throw err;
  }
}

export async function runTunnelDomainCommand(
  newValue: string | null,
): Promise<void> {
  const before = loadTunnelConfig().baseDomain;
  if (newValue === null) {
    await renderStatic(
      <Listing
        header={HEADER_DOMAIN}
        status="passed"
        tail={`Current tunnel base domain: ${before}.`}
      >
        <Item name="base-domain" description={before} />
      </Listing>,
    );
    return;
  }
  try {
    setTunnelBaseDomain(newValue);
    const after = loadTunnelConfig().baseDomain;
    await renderStatic(
      <Listing
        header={HEADER_DOMAIN}
        status="passed"
        variant="flow"
        pre={<FlowLine>{`${blue(before)} → ${blue(after)}`}</FlowLine>}
        tail={
          before === after
            ? `Unchanged · base domain is ${blue(after)}.`
            : `Tunnel base domain set to ${blue(after)}. Confirm the *.${after} CNAME exists in your Cloudflare zone.`
        }
      >
        <Item name="base-domain" description={after} />
      </Listing>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={HEADER_DOMAIN}
        status="failed"
        tail={msg}
        tailVariant="error"
      />,
    );
    throw err;
  }
}

export async function runTunnelUnexposeCommand(appName: string): Promise<void> {
  try {
    const tunnelCfg = loadTunnelConfig();
    const { config, registry } = await loadRegistryForTunnel();
    const result = await unexposeApp(
      appName,
      registry,
      config,
      tunnelCfg.baseDomain,
    );
    updateTunnelExposed((current) => {
      const next = { ...current };
      delete next[result.release];
      return next;
    });
    await renderStatic(
      <Listing
        header={HEADER_UNEXPOSE}
        status="passed"
        variant="flow"
        pre={<FlowLine>{`Unexposing ${blue(result.release)}`}</FlowLine>}
        tail={`Removed *.${tunnelCfg.baseDomain} hosts from ${blue(result.release)}.`}
      >
        <Item name="release" description={result.release} />
        <Item name="namespace" description={result.namespace} />
      </Listing>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={HEADER_UNEXPOSE}
        status="failed"
        tail={msg}
        tailVariant="error"
      />,
    );
    throw err;
  }
}
