import { Args, Command } from "@oclif/core";
import { loadConfig, runAuthConfigEmailTest } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigEmailTest extends Command {
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
