import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runTapList } from "@agent-ix/ix-cli-elements";

export default class ElementsTapList extends BaseCommand {
  static description = "List configured element taps.";

  async run(): Promise<void> {
    runTapList();
  }
}
