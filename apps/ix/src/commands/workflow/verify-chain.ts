import { Args, Command } from "@oclif/core";
import {
  emitWorkflowResult,
  workflowOutputFlags,
  workflowRunner,
} from "../../workflow.js";

export default class WorkflowVerifyChain extends Command {
  static description = "Verify workflow event hash chain integrity.";

  static args = {
    id: Args.string({ required: true, description: "Workflow instance id." }),
  };

  static flags = workflowOutputFlags;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowVerifyChain);
    const result = await workflowRunner(flags).verifyChain(args.id);
    await emitWorkflowResult(result, flags, this.log.bind(this));
    if (!result.ok) this.exit(1);
  }
}
