import { Command } from "@oclif/core";
import { loadConfig, runAuthConfigSocialList } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigSocialList extends Command {
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
