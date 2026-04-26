import { Command, Flags } from "@oclif/core";
import { runElementsList } from "@agent-ix/ix-cli-elements";

export default class ElementsList extends Command {
  static description =
    "List available element types across all configured taps.";

  static flags = {
    refresh: Flags.boolean({
      description: "Bypass cache and re-fetch from all taps.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ElementsList);
    try {
      await runElementsList({ refresh: flags.refresh });
    } catch {
      this.exit(1);
    }
  }
}
