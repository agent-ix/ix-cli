import { Args, Command } from "@oclif/core";
import { removePlugin } from "@agent-ix/ix-cli-core";
import { startListing } from "@agent-ix/ix-ui-cli";

export default class PluginRemove extends Command {
  static description = "Remove an installed ix CLI plugin.";

  static args = {
    name: Args.string({ required: true, description: "Plugin package name." }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PluginRemove);
    const list = startListing(`ix plugin remove`);
    list.commit();
    try {
      await removePlugin(args.name);
      list.success(`Plugin ${args.name} removed.`);
    } catch (err) {
      list.error(
        `Failed to remove plugin: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.exit(1);
    }
  }
}
