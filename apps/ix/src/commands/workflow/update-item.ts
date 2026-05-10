import { Args, Command } from "@oclif/core";
import {
  emitWorkflowResult,
  parseJsonArg,
  workflowOutputFlags,
  workflowRunner,
} from "../../workflow.js";

export default class WorkflowUpdateItem extends Command {
  static description = "Patch a workflow item from a JSON object.";

  static args = {
    id: Args.string({ required: true, description: "Workflow instance id." }),
    type: Args.string({ required: true, description: "Item type." }),
    itemId: Args.string({ required: true, description: "Item id." }),
    patch: Args.string({ required: true, description: "Patch JSON object." }),
  };

  static flags = workflowOutputFlags;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowUpdateItem);
    const result = await workflowRunner(flags).updateItem({
      id: args.id,
      type: args.type,
      itemId: args.itemId,
      patch: parseJsonArg(args.patch),
    });
    await emitWorkflowResult(result, flags, this.log.bind(this));
    if (!result.ok) this.exit(1);
  }
}
