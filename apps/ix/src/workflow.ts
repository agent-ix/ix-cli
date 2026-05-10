import { Flags } from "@oclif/core";
import {
  WorkflowCommandRunner,
  jsonEnvelope,
  renderHumanWorkflowResult,
  type AddItemInput,
  type WorkflowResultEnvelope,
} from "@agent-ix/workflow-cli-plugin";

export const workflowOutputFlags = {
  json: Flags.boolean({
    description: "Print machine-readable JSON.",
    default: false,
  }),
  "state-dir": Flags.string({
    description: "Workflow state directory.",
  }),
};

export function workflowRunner(flags: {
  "state-dir"?: string;
}): WorkflowCommandRunner {
  return new WorkflowCommandRunner({
    config: flags["state-dir"] ? { stateDir: flags["state-dir"] } : undefined,
  });
}

export async function emitWorkflowResult(
  result: WorkflowResultEnvelope,
  flags: { json?: boolean },
  log: (message: string) => void,
): Promise<void> {
  if (flags.json) {
    log(jsonEnvelope(result));
    return;
  }
  await renderHumanWorkflowResult(result);
}

export function parseJsonArg(value: string): AddItemInput["item"] {
  return JSON.parse(value) as AddItemInput["item"];
}
