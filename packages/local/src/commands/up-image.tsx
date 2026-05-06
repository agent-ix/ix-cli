/**
 * FR-008 — Image-Mode Deployable Installation
 * FR-013 — Composable App Expansion
 * FR-021 — Concurrent Service Startup with Rate Control
 * FR-022 — App Startup Display
 */

import { Text, blue, colors, GLYPH_DIM_DOT } from "@agent-ix/ix-ui-cli";
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
  const plan = await planImageModeUp(deployable, config, expandApp, opts);
  const preflight = (
    <>
      <Text>
        {`    ${GLYPH_DIM_DOT} ${colors.dim("Loading Helm charts from")} ${blue(config.helmChartRegistry)}`}
      </Text>
      <Text>
        {`    ${GLYPH_DIM_DOT} ${colors.dim(
          deployable.role === "app" ? "Starting App:" : "Starting Service:",
        )} ${blue(deployable.name)}`}
      </Text>
    </>
  );

  if (plan.mode === "service") {
    const result = await renderPhaseTableRun<Phase, ImageInstallPipelineResult>(
      {
        header,
        phases: PHASES,
        phaseLabels: PHASE_LABELS,
        preflight,
        initialServices: initialImageRows([plan.install]),
        controller: (emit) =>
          runSingleServicePipeline(
            {
              install: plan.install,
              deployable,
              config,
              tagOverride,
              opts,
            },
            emit,
          ),
        frameForSuccess: ({ failures, ingressUrls }) =>
          failures.length > 0
            ? {
                status: "passed",
                tail: `Deployed ${deployable.name} with failures: ${failures.join("; ")}`,
                tailVariant: "warn",
              }
            : {
                status: "passed",
                tailIngressUrls: ingressUrls,
              },
        frameForError: (err) => ({
          status: "failed",
          tail: `Failed to deploy ${deployable.name}: ${
            err instanceof ImageInstallPipelineError
              ? (err.finalDisplayError ?? err.message)
              : err.message
          }`,
          tailVariant: "error",
        }),
      },
    );
    if (result.failures.length > 0 && !opts.continueOnError) {
      throw new Error(`${deployable.name}: ${result.failures.join("; ")}`);
    }
    return;
  }

  const result = await renderPhaseTableRun<Phase, ImageInstallPipelineResult>({
    header,
    phases: PHASES,
    phaseLabels: PHASE_LABELS,
    preflight,
    initialServices: initialImageRows(plan.installs),
    controller: (emit) => {
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
    frameForSuccess: ({ failures, ingressUrls }) =>
      failures.length > 0
        ? {
            status: "failed",
            tail: `${failures.length} service${failures.length === 1 ? "" : "s"} failed`,
            tailVariant: "error",
          }
        : {
            status: "passed",
            tailIngressUrls: ingressUrls,
          },
    frameForError: (err) => ({
      status: "failed",
      tail:
        err instanceof ImageInstallPipelineError
          ? (err.finalDisplayError ?? err.message)
          : err.message,
      tailVariant: "error",
    }),
  });

  if (result.failures.length > 0) {
    throw new Error(
      `App '${deployable.name}' failed: ${result.failures.join("; ")}`,
    );
  }
}
