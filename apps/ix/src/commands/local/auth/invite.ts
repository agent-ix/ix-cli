import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthInvite } from "@agent-ix/ix-cli-local";

export default class LocalAuthInvite extends BaseCommand {
  static description = "Invite a new user by email.";

  static args = {
    email: Args.string({
      required: true,
      description: "Target email address.",
    }),
  };

  static flags = {
    username: Flags.string({
      description: "Username (default: derived from email).",
    }),
    "display-name": Flags.string({ description: "Display name." }),
    groups: Flags.string({ description: "Comma-separated group list." }),
    ttl: Flags.integer({
      description: "Invite token TTL in hours (1-168, default: 72).",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthInvite);
    const config = loadConfig();
    try {
      await runAuthInvite(config, args.email, {
        username: flags.username,
        displayName: flags["display-name"],
        groups: flags.groups,
        ttl: flags.ttl,
      });
    } catch {
      this.exit(1);
    }
  }
}
