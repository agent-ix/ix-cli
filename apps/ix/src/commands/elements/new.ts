import { Args, Command } from "@oclif/core";
import { runElementsNew } from "@agent-ix/ix-cli-elements";

export default class ElementsNew extends Command {
  static description =
    "Author a new element type (scaffolds spec + cookiecutter repo).";

  static args = {
    name: Args.string({
      description: "Element type name (e.g. rust-service).",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ElementsNew);
    try {
      await runElementsNew(args.name);
    } catch {
      this.exit(1);
    }
  }
}
