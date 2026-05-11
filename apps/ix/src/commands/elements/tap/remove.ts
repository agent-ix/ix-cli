import { Args } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runTapRemove } from "@agent-ix/ix-cli-elements";

export default class ElementsTapRemove extends BaseCommand {
  static description = "Remove a configured element tap.";

  static args = {
    url: Args.string({
      description: "Tap URL to remove.",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ElementsTapRemove);
    try {
      await runTapRemove(args.url);
    } catch {
      this.exit(1);
    }
  }
}
