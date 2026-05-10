import { Args, Command, Flags } from "@oclif/core";
import {
  emitWorkflowResult,
  workflowOutputFlags,
  workflowRunner,
} from "../../workflow.js";

export default class WorkflowCreate extends Command {
  static description = "Create a workflow instance.";

  static args = {
    definition: Args.string({
      description: "Workflow definition name.",
      required: false,
    }),
  };

  static flags = {
    ...workflowOutputFlags,
    id: Flags.string({ description: "Workflow instance id." }),
    name: Flags.string({ description: "Workflow display name." }),
    target: Flags.string({
      description: "Target file or reference.",
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowCreate);
    const result = await workflowRunner(flags).create({
      id: flags.id,
      definitionName: args.definition,
      name: flags.name,
      targets: flags.target?.map((ref) => ({ kind: "file", ref })),
    });
    await emitWorkflowResult(result, flags, this.log.bind(this));
    if (!result.ok) this.exit(1);
  }
}
