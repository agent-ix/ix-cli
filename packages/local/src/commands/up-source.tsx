import { FlowLine, blue, colors } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";
import { renderPhaseTableRun } from "../phase-table-runner.js";
import {
  initialSourceRows,
  planSourceModeUp,
  runSourceModePipeline,
  SOURCE_PHASE_LABELS,
  SOURCE_PHASES,
  type SourceModeResult,
  type SourcePhase,
  type UpFilterOptions,
} from "../up-source-controller.js";

export {
  resolveProfileValuesPath,
  type UpFilterOptions,
} from "../up-source-controller.js";

export async function runSourceModeUp(
  services: string[],
  config: IxConfig,
  tagOverride: string | null,
  devDir: string,
  opts: UpFilterOptions = {},
): Promise<void> {
  const header = `ix local up · ${services.join(", ")}`;
  const plan = await planSourceModeUp(
    services,
    config,
    tagOverride,
    devDir,
    opts,
  );

  try {
    await renderPhaseTableRun<SourcePhase, SourceModeResult>({
      header,
      phases: SOURCE_PHASES,
      phaseLabels: SOURCE_PHASE_LABELS,
      preflight: (
        <>
          <FlowLine>{`${colors.dim("Loading Helm charts from")} ${blue(
            config.helmChartRegistry,
          )}`}</FlowLine>
          <FlowLine>{`${colors.dim(
            plan.installs.length > 1 ? "Starting App:" : "Starting Service:",
          )} ${blue(services.join(", "))}`}</FlowLine>
        </>
      ),
      initialServices: initialSourceRows(plan.installs),
      controller: (emit) => runSourceModePipeline(plan, config, opts, emit),
      frameForSuccess: ({ failures, ingressUrls }) =>
        failures.length > 0
          ? {
              status: "passed",
              tail: `Deployed from local source with failures: ${failures.join("; ")}`,
              tailVariant: "warn",
            }
          : {
              status: "passed",
              tailIngressUrls: ingressUrls,
              tailIngressHosts: config.hosts,
            },
      frameForError: (err) => ({
        status: "failed",
        tail: `Failed to deploy from local source: ${err.message}`,
        tailVariant: "error",
      }),
    });
  } finally {
    plan.dispose();
  }
}
