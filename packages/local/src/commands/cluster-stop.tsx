/**
 * FR-036 — cluster stop
 * Pause the kind cluster by stopping its node containers (preserves PVC data).
 */

import { execa } from "execa";
import { Item, Listing, renderStatic } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";

const HEADER = "ix local cluster stop";

export interface ClusterStopDeps {
  exec?: typeof execa;
}

export async function runClusterStop(
  config: IxConfig,
  _opts: Record<string, never> = {},
  deps: ClusterStopDeps = {},
): Promise<void> {
  const exec = deps.exec ?? execa;
  const clusterName = config.kindClusterName;

  // FR-036-AC-4: absent cluster fails clearly, never auto-creates.
  // Distinguish "no such cluster" (kind exits 0 with empty stdout) from a
  // kind-binary failure (missing, permission, daemon down) so the user gets
  // an actionable error in each case.
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
    let state = "stopped";
    try {
      // FR-036-AC-3: idempotent — `docker stop` on an already-stopped
      // container exits 0 and reports the name; treat as "already stopped".
      await exec("docker", ["stop", node]);
      state = "stopped";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state = `error: ${msg}`;
    }
    rows.push({ node, state });
  }

  await renderStatic(
    <Listing
      header={HEADER}
      status="passed"
      tail={`Stopped ${rows.length} node(s). Cluster paused; data preserved.`}
    >
      {rows.map((r) => (
        <Item key={r.node} name={r.node} description={r.state} />
      ))}
    </Listing>,
  );
}
