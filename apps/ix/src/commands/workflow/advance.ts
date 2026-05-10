import { Args, Command } from "@oclif/core";
import {
  emitWorkflowResult,
  workflowOutputFlags,
  workflowRunner,
} from "../../workflow.js";

export default class WorkflowAdvance extends Command {
  static description = "Advance a workflow to a target phase.";

  static args = {
    id: Args.string({ required: true, description: "Workflow instance id." }),
    phase: Args.string({ required: true, description: "Target phase." }),
  };

  static flags = workflowOutputFlags;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowAdvance);
    const result = await workflowRunner(flags).advance({
      id: args.id,
      to: args.phase,
    });
    await emitWorkflowResult(result, flags, this.log.bind(this));
    if (!result.ok) this.exit(1);
  }
}
