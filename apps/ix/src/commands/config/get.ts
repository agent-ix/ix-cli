import { Args, Command } from "@oclif/core";
import { runConfigGet } from "@agent-ix/ix-cli-core";

export default class ConfigGet extends Command {
  static description =
    "Read a config value. <plugin> defaults to 'core' when omitted.";
  static examples = [
    "ix config get logLevel",
    "ix config get local cluster.defaultTags",
  ];

  static args = {
    pluginOrKey: Args.string({
      required: true,
      description:
        "Plugin id, or (when only one positional arg is given) a core key path.",
    }),
    key: Args.string({
      description: "Dot-notated key path (when the first arg is a plugin id).",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigGet);
    const [pluginId, keyPath] = args.key
      ? [args.pluginOrKey, args.key]
      : [undefined, args.pluginOrKey];
    try {
      await runConfigGet(pluginId, keyPath);
    } catch (err) {
      this.log(err instanceof Error ? err.message : String(err));
      this.exit(1);
    }
  }
}
