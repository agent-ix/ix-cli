import { Args, Command } from "@oclif/core";
import { runConfigEdit } from "@agent-ix/ix-cli-core";

export default class ConfigEdit extends Command {
  static description =
    "Open a plugin's config file in $VISUAL/$EDITOR (default vi). On save, the file is validated against the plugin schema.";
  static examples = ["ix config edit", "ix config edit local"];

  static args = {
    plugin: Args.string({
      description: "Plugin id (defaults to 'core').",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigEdit);
    try {
      await runConfigEdit(args.plugin);
    } catch (err) {
      this.log(err instanceof Error ? err.message : String(err));
      this.exit(1);
    }
  }
}
