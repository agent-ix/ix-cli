import { Args, Command } from "@oclif/core";
import {
  emitWorkflowResult,
  workflowOutputFlags,
  workflowRunner,
} from "../../workflow.js";

export default class WorkflowStatus extends Command {
  static description = "Show workflow status.";

  static args = {
    id: Args.string({ required: true, description: "Workflow instance id." }),
  };

  static flags = workflowOutputFlags;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowStatus);
    const result = await workflowRunner(flags).status(args.id);
    await emitWorkflowResult(result, flags, this.log.bind(this));
    if (!result.ok) this.exit(1);
  }
}
