import { Command } from "@oclif/core";
import { listPlugins } from "@agent-ix/ix-cli-core";
import { introCommand, outroSuccess, log, colors } from "@agent-ix/ix-ui-cli";

export default class PluginList extends Command {
  static description = "List installed ix CLI plugins.";

  async run(): Promise<void> {
    introCommand("ix plugin list");
    const plugins = await listPlugins();
    if (plugins.length === 0) {
      outroSuccess("No plugins installed.");
      return;
    }
    for (const plugin of plugins) {
      log.info(
        `${colors.cyan(plugin.name)}${colors.dim(`@${plugin.version}`)}`,
      );
    }
    outroSuccess(`${plugins.length} plugin(s) installed.`);
  }
}
