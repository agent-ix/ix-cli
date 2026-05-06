/**
 * FR-006 — cluster down
 * Tear down the kind cluster with mandatory confirmation (NFR-002).
 */

import type React from "react";
import { execa } from "execa";
import {
  ConfirmPrompt,
  Listing,
  render,
  renderStatic,
  useEffect,
  useRenderResult,
  useState,
} from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";

const HEADER = "ix local cluster down";

async function defaultConfirm(clusterName: string): Promise<boolean> {
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

export interface ClusterDownDeps {
  /** Test seam — replace the interactive prompt with a function under test control. */
  confirm?: (clusterName: string) => Promise<boolean>;
}

export async function runClusterDown(
  config: IxConfig,
  opts: { yes?: boolean } = {},
  deps: ClusterDownDeps = {},
): Promise<void> {
  const clusterName = config.kindClusterName;
  const confirm = deps.confirm ?? defaultConfirm;

  if (!opts.yes) {
    const confirmed = await confirm(clusterName);
    if (!confirmed) {
      await renderStatic(
        <Listing
          header={HEADER}
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
        header={HEADER}
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
        header={HEADER}
        status="failed"
        tail={`Failed to delete cluster: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  }
  await renderStatic(
    <Listing
      header={HEADER}
      status="passed"
      tail={`Cluster '${clusterName}' deleted.`}
    />,
  );
}
