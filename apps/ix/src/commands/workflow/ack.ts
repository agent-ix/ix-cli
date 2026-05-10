import { Args, Command, Flags } from "@oclif/core";
import {
  emitWorkflowResult,
  workflowOutputFlags,
  workflowRunner,
} from "../../workflow.js";

export default class WorkflowAck extends Command {
  static description = "Record a workflow acknowledgement token.";

  static args = {
    id: Args.string({ required: true, description: "Workflow instance id." }),
    token: Args.string({
      required: true,
      description: "Ack token or reference.",
    }),
  };

  static flags = {
    ...workflowOutputFlags,
    kind: Flags.string({ description: "Ack artifact kind." }),
    reviewer: Flags.string({ description: "Reviewer id." }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowAck);
    const result = await workflowRunner(flags).ack({
      id: args.id,
      token: args.token,
      kind: flags.kind,
      reviewer: flags.reviewer,
    });
    await emitWorkflowResult(result, flags, this.log.bind(this));
    if (!result.ok) this.exit(1);
  }
}
