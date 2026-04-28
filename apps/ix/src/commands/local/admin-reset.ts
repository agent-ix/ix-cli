import { Command, Flags } from "@oclif/core";
import { loadConfig, runAuthResetAdmin } from "@agent-ix/ix-cli-local";

export default class LocalAdminReset extends Command {
  static description = "Re-seed the admin temp credential.";

  static flags = {
    user: Flags.string({ description: "Target admin email." }),
    ttl: Flags.integer({ description: "Token TTL in hours (default: 1)." }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalAdminReset);
    const config = loadConfig();
    try {
      await runAuthResetAdmin(config, { user: flags.user, ttl: flags.ttl });
    } catch {
      this.exit(1);
    }
  }
}
