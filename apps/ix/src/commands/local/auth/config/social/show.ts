import { Args } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthConfigSocialShow } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigSocialShow extends BaseCommand {
  static description =
    "Show a social provider config (client_secret never printed).";

  static args = {
    id: Args.string({ required: true, description: "Provider ID." }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(LocalAuthConfigSocialShow);
    const config = loadConfig();
    try {
      await runAuthConfigSocialShow(config, args.id);
    } catch {
      this.exit(1);
    }
  }
}
