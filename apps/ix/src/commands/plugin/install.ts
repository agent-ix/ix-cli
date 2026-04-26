import { Args, Command } from "@oclif/core";
import { installPlugin } from "@agent-ix/ix-cli-core";
import { introCommand, outroSuccess, outroError } from "@agent-ix/ix-ui-cli";

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
    introCommand(`ix plugin install`);
    try {
      await installPlugin(args.name);
      outroSuccess(`Plugin ${args.name} installed.`);
    } catch (err) {
      outroError(
        `Failed to install plugin: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.exit(1);
    }
  }
}
