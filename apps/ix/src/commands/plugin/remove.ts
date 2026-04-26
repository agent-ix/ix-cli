import { Args, Command } from "@oclif/core";
import { removePlugin } from "@agent-ix/ix-cli-core";
import { introCommand, outroSuccess, outroError } from "@agent-ix/ix-ui-cli";

export default class PluginRemove extends Command {
  static description = "Remove an installed ix CLI plugin.";

  static args = {
    name: Args.string({ required: true, description: "Plugin package name." }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PluginRemove);
    introCommand(`ix plugin remove`);
    try {
      await removePlugin(args.name);
      outroSuccess(`Plugin ${args.name} removed.`);
    } catch (err) {
      outroError(
        `Failed to remove plugin: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.exit(1);
    }
  }
}
