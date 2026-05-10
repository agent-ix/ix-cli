import { Args, Command } from "@oclif/core";
import {
  emitWorkflowResult,
  workflowOutputFlags,
  workflowRunner,
} from "../../workflow.js";

export default class WorkflowHistory extends Command {
  static description = "Show workflow event history.";

  static args = {
    id: Args.string({ required: true, description: "Workflow instance id." }),
  };

  static flags = workflowOutputFlags;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowHistory);
    const result = await workflowRunner(flags).history(args.id);
    await emitWorkflowResult(result, flags, this.log.bind(this));
    if (!result.ok) this.exit(1);
  }
}
