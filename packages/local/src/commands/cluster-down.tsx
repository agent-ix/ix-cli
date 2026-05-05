/**
 * FR-006 — cluster down
 * Tear down the kind cluster with mandatory confirmation (NFR-002).
 */

import React, { useEffect } from "react";
import { execa } from "execa";
import {
  ConfirmPrompt,
  Listing,
  render,
  renderStatic,
  useRenderResult,
} from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";

async function confirmDelete(clusterName: string): Promise<boolean> {
  let answer: boolean | null = null;
  const Capture: React.FC = () => {
    const { exit } = useRenderResult();
    const [done, setDone] = React.useState(false);
    useEffect(() => {
      if (done) {
        const t = setTimeout(exit, 0);
        return () => clearTimeout(t);
      }
    }, [done, exit]);
    return (
      <ConfirmPrompt
        message={`Delete kind cluster '${clusterName}'? This will destroy all cluster state and cannot be undone.`}
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

export async function runClusterDown(
  config: IxConfig,
  opts: { yes?: boolean } = {},
): Promise<void> {
  const clusterName = config.kindClusterName;

  if (!opts.yes) {
    const confirmed = await confirmDelete(clusterName);
    if (!confirmed) {
      await renderStatic(
        <Listing
          header="ix local cluster down"
          status="passed"
          tail="Cancelled. Cluster not deleted."
          tailVariant="warn"
        />,
      );
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
    await renderStatic(
      <Listing
        header="ix local cluster down"
        status="passed"
        tail={`Cluster '${clusterName}' does not exist. Nothing to delete.`}
      />,
    );
    return;
  }

  // kind delete inherits stdio for its progress output, then we render the
  // final-state listing.
  try {
    await execa("kind", ["delete", "cluster", "--name", clusterName], {
      stdio: "inherit",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header="ix local cluster down"
        status="failed"
        tail={`Failed to delete cluster: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  }
  await renderStatic(
    <Listing
      header="ix local cluster down"
      status="passed"
      tail={`Cluster '${clusterName}' deleted.`}
    />,
  );
}
