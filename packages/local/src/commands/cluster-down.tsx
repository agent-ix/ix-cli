/**
 * FR-006 — cluster down
 * Tear down the kind cluster with mandatory confirmation (NFR-002).
 */

import type React from "react";
import { execa } from "execa";
import {
  ConfirmPrompt,
  Listing,
  TextPrompt,
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

// FR-006-AC-6: second confirmation gate — user must retype the cluster name.
// Returns "match" when the typed value equals clusterName, "mismatch" when
// they typed something else, and "cancelled" when the prompt was aborted
// (ESC). Distinguishing the latter lets the caller surface a clearer error.
export type NameConfirmResult = "match" | "mismatch" | "cancelled";

async function defaultConfirmName(
  clusterName: string,
): Promise<NameConfirmResult> {
  let result: NameConfirmResult = "cancelled";
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
      <TextPrompt
        message={`Type the cluster name '${clusterName}' to confirm deletion:`}
        onSubmit={(r) => {
          if (!r.ok) {
            result = "cancelled";
          } else {
            result = r.value === clusterName ? "match" : "mismatch";
          }
          setDone(true);
        }}
      />
    );
  };
  await render(<Capture />);
  return result;
}

export interface ClusterDownDeps {
  /** Test seam — replace the interactive prompt with a function under test control. */
  confirm?: (clusterName: string) => Promise<boolean>;
  /** Test seam — replace the second name-retype prompt. */
  confirmName?: (clusterName: string) => Promise<NameConfirmResult>;
}

export async function runClusterDown(
  config: IxConfig,
  opts: { yes?: boolean } = {},
  deps: ClusterDownDeps = {},
): Promise<void> {
  const clusterName = config.kindClusterName;
  const confirm = deps.confirm ?? defaultConfirm;
  const confirmName = deps.confirmName ?? defaultConfirmName;

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
    // FR-006-AC-6: second gate — retype cluster name. Mismatch or cancel aborts.
    const nameResult = await confirmName(clusterName);
    if (nameResult !== "match") {
      const tail =
        nameResult === "cancelled"
          ? "Cancelled. Cluster not deleted."
          : `Name did not match '${clusterName}'. Aborting — cluster not deleted.`;
      await renderStatic(
        <Listing
          header={HEADER}
          status={nameResult === "cancelled" ? "passed" : "failed"}
          tail={tail}
          tailVariant={nameResult === "cancelled" ? "warn" : "error"}
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
