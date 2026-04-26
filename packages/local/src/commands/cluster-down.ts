/**
 * FR-006 — cluster down
 * Tear down the kind cluster with mandatory confirmation (NFR-002).
 */

import { execa } from "execa";
import {
  confirm,
  isCancel,
  introCommand,
  outroSuccess,
  outroError,
} from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";

export async function runClusterDown(
  config: IxConfig,
  opts: { yes?: boolean } = {},
): Promise<void> {
  const clusterName = config.kindClusterName;

  if (!opts.yes) {
    // NFR-002: prompt must name the specific cluster
    const confirmed = await confirm({
      message: `Delete kind cluster '${clusterName}'? This will destroy all cluster state and cannot be undone.`,
      initialValue: false,
    });

    if (isCancel(confirmed) || !confirmed) {
      outroSuccess("Cancelled. Cluster not deleted.");
      return;
    }
  }

  introCommand("ix local cluster down");

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
    outroSuccess(`Cluster '${clusterName}' does not exist. Nothing to delete.`);
    return;
  }

  try {
    await execa("kind", ["delete", "cluster", "--name", clusterName], {
      stdio: "inherit",
    });
    outroSuccess(`Cluster '${clusterName}' deleted.`);
  } catch (err) {
    outroError(
      `Failed to delete cluster: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
