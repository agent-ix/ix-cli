/**
 * FR-008 — Image-Mode Deployable Installation
 * FR-013 — Composable App Expansion
 * FR-021 — Concurrent Service Startup with Rate Control
 * FR-022 — App Startup Display
 */

import { FlowLine, blue, colors } from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";
import type { Deployable } from "../discovery.js";
import { PHASES, PHASE_LABELS, type Phase } from "../phases.js";
import { renderPhaseTableRun } from "../phase-table-runner.js";
import { AppInstallRows } from "../app-row-state.js";
import {
  appRowServices,
  defaultExpandApp,
  initialImageRows,
  planImageModeUp,
  runAppInstallPipeline,
  runSingleServicePipeline,
  ImageInstallPipelineError,
  type AppExpander,
  type ImageInstallPipelineResult,
  type UpImageOptions,
} from "../up-image-controller.js";

export {
  defaultExpandApp,
  parseChartDependencies,
  type AppExpander,
  type ChildInstall,
  type UpImageOptions,
} from "../up-image-controller.js";

export async function runImageModeUp(
  deployable: Deployable,
  config: IxConfig,
  tagOverride: string | null,
  expandApp: AppExpander = defaultExpandApp,
  opts: UpImageOptions = {},
): Promise<void> {
  const header = `ix local up · ${deployable.name}`;
  const preflight = (
    <>
      <FlowLine>{`${colors.dim("Loading Helm charts from")} ${blue(
        config.helmChartRegistry,
      )}`}</FlowLine>
      <FlowLine>{`${colors.dim(
        deployable.role === "app" ? "Starting App:" : "Starting Service:",
      )} ${blue(deployable.name)}`}</FlowLine>
    </>
  );

  // Render the header + preflight text immediately so the user sees the
  // frame instead of a blank terminal while planImageModeUp's helm/kubectl
  // shellouts run. The install rows are populated by the controller once
  // planning resolves; the controller then drives the install pipeline.
  // `runMode` is set inside the controller before it resolves, so the
  // frame callbacks read the correct branch.
  let runMode: "service" | "app" =
    deployable.role === "app" ? "app" : "service";
  const result = await renderPhaseTableRun<Phase, ImageInstallPipelineResult>({
    header,
    phases: PHASES,
    phaseLabels: PHASE_LABELS,
    preflight,
    initialServices: [],
    controller: async (emit) => {
      const plan = await planImageModeUp(deployable, config, expandApp, opts);
      runMode = plan.mode;
      if (plan.mode === "service") {
        emit(initialImageRows([plan.install]));
        return runSingleServicePipeline(
          { install: plan.install, deployable, config, tagOverride, opts },
          emit,
        );
      }
      emit(initialImageRows(plan.installs));
      const appRows = new AppInstallRows(appRowServices(plan.installs), emit);
      return runAppInstallPipeline({
        deployable,
        installs: plan.installs,
        config,
        tagOverride,
        pools: plan.pools,
        appRows,
      });
    },
    frameForSuccess: ({ failures, ingressUrls }) => {
      if (runMode === "service") {
        return failures.length > 0
          ? {
              status: "passed",
              tail: `Deployed ${deployable.name} with failures: ${failures.join("; ")}`,
              tailVariant: "warn",
            }
          : {
              status: "passed",
              tailIngressUrls: ingressUrls,
              tailIngressHosts: config.hosts,
            };
      }
      return failures.length > 0
        ? {
            status: "failed",
            tail: `${failures.length} service${failures.length === 1 ? "" : "s"} failed`,
            tailVariant: "error",
          }
        : {
            status: "passed",
            tailIngressUrls: ingressUrls,
            tailIngressHosts: config.hosts,
          };
    },
    frameForError: (err) => {
      const msg =
        err instanceof ImageInstallPipelineError
          ? (err.finalDisplayError ?? err.message)
          : err.message;
      return {
        status: "failed",
        tail:
          runMode === "service"
            ? `Failed to deploy ${deployable.name}: ${msg}`
            : msg,
        tailVariant: "error",
      };
    },
  });

  if (runMode === "service") {
    if (result.failures.length > 0 && !opts.continueOnError) {
      throw new Error(`${deployable.name}: ${result.failures.join("; ")}`);
    }
    return;
  }
  if (result.failures.length > 0) {
    throw new Error(
      `App '${deployable.name}' failed: ${result.failures.join("; ")}`,
    );
  }
}
