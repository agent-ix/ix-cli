import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  const header = `ix local up · ${services.join(", ")} · source`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-local-source-"));

  try {
    const plan = await planSourceModeUp(
      services,
      config,
      tagOverride,
      devDir,
      tmpDir,
      opts,
    );

    await renderPhaseTableRun<SourcePhase, SourceModeResult>({
      header,
      phases: SOURCE_PHASES,
      phaseLabels: SOURCE_PHASE_LABELS,
      initialServices: initialSourceRows(plan.installs),
      controller: (emit) => runSourceModePipeline(plan, config, opts, emit),
      frameForSuccess: ({ failures, urls }) =>
        failures.length > 0
          ? {
              status: "passed",
              tail: `Deployed from local source with failures: ${failures.join("; ")}`,
              tailVariant: "warn",
            }
          : {
              status: "passed",
              tail: urls.join("  "),
              tailVariant: "success",
            },
      frameForError: (err) => ({
        status: "failed",
        tail: `Failed to deploy from local source: ${err.message}`,
        tailVariant: "error",
      }),
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
