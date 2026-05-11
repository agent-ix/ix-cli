import { Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthResetAdmin } from "@agent-ix/ix-cli-local";

export default class LocalAdminReset extends BaseCommand {
  static description = "Re-seed the admin temp credential.";

  static flags = {
    user: Flags.string({
      description: "Target admin email/username (when multiple admins exist).",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalAdminReset);
    const config = loadConfig();
    try {
      await runAuthResetAdmin(config, { user: flags.user });
    } catch {
      this.exit(1);
    }
  }
}
