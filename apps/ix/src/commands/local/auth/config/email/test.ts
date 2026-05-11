import { Args } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthConfigEmailTest } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigEmailTest extends BaseCommand {
  static description = "Send a test email.";

  static args = {
    to: Args.string({
      required: true,
      description: "Recipient email address.",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(LocalAuthConfigEmailTest);
    const config = loadConfig();
    try {
      await runAuthConfigEmailTest(config, args.to);
    } catch {
      this.exit(1);
    }
  }
}
