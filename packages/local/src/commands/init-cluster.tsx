/**
 * FR-007 — init-cluster Command
 *
 * The live Ink command wrapper delegates all process work to
 * init-cluster-controller so React owns rendering only.
 */

import { FlowLine, colors } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";
import { renderPhaseTableRun } from "../phase-table-runner.js";
import {
  INIT_PHASE_LABELS,
  INIT_PHASES,
  initialInitRows,
  runInitClusterController,
  type InitClusterResult,
  type InitPhase,
} from "../init-cluster-controller.js";

export { buildKindConfig } from "../init-cluster-controller.js";

export async function runInitCluster(
  config: IxConfig,
  _reconfigureCredentials: boolean,
): Promise<void> {
  const preflight = (
    <FlowLine>{colors.dim("Initializing local cluster")}</FlowLine>
  );
  await renderPhaseTableRun<InitPhase, InitClusterResult>({
    header: "ix · local · init-cluster",
    phases: INIT_PHASES,
    phaseLabels: INIT_PHASE_LABELS,
    preflight,
    initialServices: initialInitRows(),
    controller: (emit) => runInitClusterController(config, emit),
    frameForSuccess: ({ clusterIp }) => {
      const dnsTail = clusterIp
        ? `DNS: add  ${config.hosts
            .map((h) => `address=/.${h}/${clusterIp}`)
            .join("  ")}  to /etc/dnsmasq.conf`
        : undefined;
      return { status: "passed", tail: dnsTail };
    },
    frameForError: (err) => ({
      status: "failed",
      tail: err.message,
      tailVariant: "error",
    }),
  });
}
