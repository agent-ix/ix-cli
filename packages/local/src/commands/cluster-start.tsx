/**
 * FR-036 — cluster start
 * Resume the kind cluster by starting its node containers and waiting for
 * the API server to respond.
 */

import { execa } from "execa";
import { Item, Listing, Note, renderStatic } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";

const HEADER = "ix local cluster start";

const API_TIMEOUT_MS = 60_000;
const API_POLL_INTERVAL_MS = 2_000;

export interface ClusterStartDeps {
  exec?: typeof execa;
  /** Test seam — overrides the wait-for-API loop with deterministic behavior. */
  waitForApi?: (timeoutMs: number) => Promise<boolean>;
}

async function defaultWaitForApi(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await execa("kubectl", ["get", "ns"], { timeout: API_POLL_INTERVAL_MS });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, API_POLL_INTERVAL_MS));
    }
  }
  return false;
}

export async function runClusterStart(
  config: IxConfig,
  _opts: Record<string, never> = {},
  deps: ClusterStartDeps = {},
): Promise<void> {
  const exec = deps.exec ?? execa;
  const waitForApi = deps.waitForApi ?? defaultWaitForApi;
  const clusterName = config.kindClusterName;

  let nodes: string[] = [];
  let kindError: Error | null = null;
  try {
    const { stdout } = await exec("kind", [
      "get",
      "nodes",
      "--name",
      clusterName,
    ]);
    nodes = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    kindError = err instanceof Error ? err : new Error(String(err));
  }

  if (kindError) {
    const tail = `\`kind get nodes\` failed: ${kindError.message}. Is kind installed and the docker daemon running?`;
    await renderStatic(
      <Listing
        header={HEADER}
        status="failed"
        tail={tail}
        tailVariant="error"
      />,
    );
    throw kindError;
  }

  if (nodes.length === 0) {
    await renderStatic(
      <Listing
        header={HEADER}
        status="failed"
        tail={`No kind cluster '${clusterName}' found. Run \`ix local init\` first.`}
        tailVariant="error"
      />,
    );
    throw new Error(`kind cluster '${clusterName}' does not exist`);
  }

  const rows: { node: string; state: string }[] = [];
  for (const node of nodes) {
    let state = "running";
    try {
      await exec("docker", ["start", node]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state = `error: ${msg}`;
    }
    rows.push({ node, state });
  }

  const apiReady = await waitForApi(API_TIMEOUT_MS);

  await renderStatic(
    <Listing
      header={HEADER}
      status="passed"
      tailVariant={apiReady ? undefined : "warn"}
      tail={
        apiReady
          ? `Started ${rows.length} node(s). API server reachable.`
          : `Started ${rows.length} node(s). API server did not respond within ${API_TIMEOUT_MS / 1000}s — check cluster manually.`
      }
    >
      {rows.map((r) => (
        <Item key={r.node} name={r.node} description={r.state} />
      ))}
      {!apiReady && (
        <Note>
          {`Containers are running but \`kubectl get ns\` did not succeed. Try \`ix local cluster status\` once the API stabilizes.`}
        </Note>
      )}
    </Listing>,
  );
}
