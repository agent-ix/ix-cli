import { Args } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runConfigSet } from "@agent-ix/ix-cli-core";

export default class ConfigSet extends BaseCommand {
  static description =
    "Set a config value. Scalars are coerced via the schema; non-scalar (array/object) values MUST be valid JSON.";
  static examples = [
    "ix config set logLevel debug",
    "ix config set local concurrency.dockerPull 7",
    `ix config set local cluster.defaultTags '["ix-core","ix-data"]'`,
  ];

  static strict = false; // accept variadic (we only use first 3 positionals)

  static args = {
    a: Args.string({ required: true, description: "plugin id OR key path" }),
    b: Args.string({ required: true, description: "key path OR value" }),
    c: Args.string({
      description: "value (when both plugin id and key are provided)",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigSet);
    let pluginId: string | undefined;
    let keyPath: string;
    let value: string;

    if (args.c !== undefined) {
      pluginId = args.a;
      keyPath = args.b;
      value = args.c;
    } else {
      pluginId = undefined;
      keyPath = args.a;
      value = args.b;
    }

    try {
      await runConfigSet(pluginId, keyPath, value);
    } catch (err) {
      this.log(err instanceof Error ? err.message : String(err));
      this.exit(1);
    }
  }
}
