import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthConfigSocialList } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigSocialList extends BaseCommand {
  static description = "List configured social providers.";

  async run(): Promise<void> {
    const config = loadConfig();
    try {
      await runAuthConfigSocialList(config);
    } catch {
      this.exit(1);
    }
  }
}
