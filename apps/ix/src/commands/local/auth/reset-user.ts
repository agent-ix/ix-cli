import { Args, Command, Flags } from "@oclif/core";
import { loadConfig, runAuthResetUser } from "@agent-ix/ix-cli-local";

export default class LocalAuthResetUser extends Command {
  static description = "Admin-initiated password reset for any user.";

  static args = {
    email: Args.string({
      required: true,
      description: "Target email address.",
    }),
  };

  static flags = {
    ttl: Flags.integer({
      description: "Reset token TTL in hours (1-24, default: 1).",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthResetUser);
    const config = loadConfig();
    try {
      await runAuthResetUser(config, args.email, { ttl: flags.ttl });
    } catch {
      this.exit(1);
    }
  }
}
