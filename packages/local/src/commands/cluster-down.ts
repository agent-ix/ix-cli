/**
 * FR-006 — cluster down
 * Tear down the kind cluster with mandatory confirmation (NFR-002).
 */

import { execa } from "execa";
import { confirm, isCancel, startListing } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";

export async function runClusterDown(
  config: IxConfig,
  opts: { yes?: boolean } = {},
): Promise<void> {
  const clusterName = config.kindClusterName;
  const list = startListing("ix local cluster down");

  if (!opts.yes) {
    // NFR-002: prompt must name the specific cluster
    const confirmed = await list.pause(() =>
      confirm({
        message: `Delete kind cluster '${clusterName}'? This will destroy all cluster state and cannot be undone.`,
        initialValue: false,
      }),
    );

    if (isCancel(confirmed) || !confirmed) {
      list.warn("Cancelled. Cluster not deleted.");
      return;
    }
  }

  // FR-006-AC-3: idempotent — check existence before deleting
  let clusterExists = false;
  try {
    const { stdout } = await execa("kind", ["get", "clusters"]);
    clusterExists = stdout
      .split("\n")
      .map((s) => s.trim())
      .includes(clusterName);
  } catch {
    clusterExists = false;
  }

  if (!clusterExists) {
    list.success(`Cluster '${clusterName}' does not exist. Nothing to delete.`);
    return;
  }

  list.commit();
  try {
    await execa("kind", ["delete", "cluster", "--name", clusterName], {
      stdio: "inherit",
    });
    list.success(`Cluster '${clusterName}' deleted.`);
  } catch (err) {
    list.error(
      `Failed to delete cluster: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
