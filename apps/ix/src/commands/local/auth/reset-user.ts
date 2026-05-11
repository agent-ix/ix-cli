import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthResetUser } from "@agent-ix/ix-cli-local";

export default class LocalAuthResetUser extends BaseCommand {
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
