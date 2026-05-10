import { Args, Command } from "@oclif/core";
import {
  emitWorkflowResult,
  parseJsonArg,
  workflowOutputFlags,
  workflowRunner,
} from "../../workflow.js";

export default class WorkflowLinkItems extends Command {
  static description = "Add a workflow link from a JSON object.";

  static args = {
    id: Args.string({ required: true, description: "Workflow instance id." }),
    link: Args.string({ required: true, description: "Link JSON object." }),
  };

  static flags = workflowOutputFlags;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowLinkItems);
    const result = await workflowRunner(flags).linkItems({
      id: args.id,
      link: parseJsonArg(args.link),
    });
    await emitWorkflowResult(result, flags, this.log.bind(this));
    if (!result.ok) this.exit(1);
  }
}
