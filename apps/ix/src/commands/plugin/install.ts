import { Args, Command } from "@oclif/core";
import { installPlugin } from "@agent-ix/ix-cli-core";
import { startListing } from "@agent-ix/ix-ui-cli";

export default class PluginInstall extends Command {
  static description = "Install an ix CLI plugin.";

  static args = {
    name: Args.string({
      required: true,
      description: "Plugin package name (npm).",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PluginInstall);
    const list = startListing(`ix plugin install`);
    list.commit();
    try {
      await installPlugin(args.name);
      list.success(`Plugin ${args.name} installed.`);
    } catch (err) {
      list.error(
        `Failed to install plugin: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.exit(1);
    }
  }
}
