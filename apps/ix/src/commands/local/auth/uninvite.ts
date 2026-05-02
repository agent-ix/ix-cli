import { Args, Command } from "@oclif/core";
import { loadConfig, runAuthUninvite } from "@agent-ix/ix-cli-local";

export default class LocalAuthUninvite extends Command {
  static description =
    "Revoke any outstanding invite tokens for a pending user.";

  static args = {
    email: Args.string({
      required: true,
      description: "Target email address.",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(LocalAuthUninvite);
    const config = loadConfig();
    try {
      await runAuthUninvite(config, args.email);
    } catch {
      this.exit(1);
    }
  }
}
