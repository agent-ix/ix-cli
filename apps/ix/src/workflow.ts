import { Flags } from "@oclif/core";
import { ConfigService } from "@agent-ix/ix-cli-core";
import {
  WORKFLOW_PLUGIN_ID,
  WorkflowCommandRunner,
  WorkflowPluginConfigSchema,
  WorkflowPluginEnvBindings,
  jsonEnvelope,
  renderHumanWorkflowResult,
  type AddItemInput,
  type WorkflowPluginConfig,
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
  const config = workflowConfig(flags);
  return new WorkflowCommandRunner({
    config,
  });
}

export function workflowConfig(flags: {
  "state-dir"?: string;
}): WorkflowPluginConfig {
  const configured = ConfigService.forPlugin(
    WORKFLOW_PLUGIN_ID,
    WorkflowPluginConfigSchema,
    { envBindings: WorkflowPluginEnvBindings },
  ).get();
  return {
    ...configured,
    stateDir: flags["state-dir"] ?? configured.stateDir,
  };
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
