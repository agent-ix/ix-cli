import { Command } from "@oclif/core";
import { listPlugins } from "@agent-ix/ix-cli-core";
import { startListing } from "@agent-ix/ix-ui-cli";

export default class PluginList extends Command {
  static description = "List installed ix CLI plugins.";

  async run(): Promise<void> {
    const list = startListing("ix plugin list");
    const plugins = await listPlugins();
    if (plugins.length === 0) {
      list.success("No plugins installed.");
      return;
    }
    for (const plugin of plugins) {
      list.item(plugin.name, plugin.version);
    }
    list.success(`${plugins.length} plugin(s) installed.`);
  }
}
