import { Args, Command } from "@oclif/core";
import {
  emitWorkflowResult,
  parseJsonArg,
  workflowOutputFlags,
  workflowRunner,
} from "../../workflow.js";

export default class WorkflowAddItem extends Command {
  static description = "Add a workflow item from a JSON object.";

  static args = {
    id: Args.string({ required: true, description: "Workflow instance id." }),
    type: Args.string({ required: true, description: "Item type." }),
    item: Args.string({ required: true, description: "Item JSON object." }),
  };

  static flags = workflowOutputFlags;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowAddItem);
    const result = await workflowRunner(flags).addItem({
      id: args.id,
      type: args.type,
      item: parseJsonArg(args.item),
    });
    await emitWorkflowResult(result, flags, this.log.bind(this));
    if (!result.ok) this.exit(1);
  }
}
