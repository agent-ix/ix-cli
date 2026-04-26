import { Command } from "@oclif/core";
import { runTapList } from "@agent-ix/ix-cli-elements";

export default class ElementsTapList extends Command {
  static description = "List configured element taps.";

  async run(): Promise<void> {
    runTapList();
  }
}
