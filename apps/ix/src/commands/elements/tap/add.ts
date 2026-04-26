import { Args, Command } from "@oclif/core";
import { runTapAdd } from "@agent-ix/ix-cli-elements";

export default class ElementsTapAdd extends Command {
  static description = "Add an element tap (GitHub org or single repo).";

  static args = {
    url: Args.string({
      description:
        "Tap URL, e.g. github.com/my-org or github.com/my-org/my-element.",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ElementsTapAdd);
    try {
      await runTapAdd(args.url);
    } catch {
      this.exit(1);
    }
  }
}
