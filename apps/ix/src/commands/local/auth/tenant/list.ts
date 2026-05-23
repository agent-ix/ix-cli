import { Args } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthTenantList } from "@agent-ix/ix-cli-local";

export default class LocalAuthTenantList extends BaseCommand {
  static description = "List tenant memberships for a user (FR-042).";

  static args = {
    email: Args.string({
      required: true,
      description: "User email or username.",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(LocalAuthTenantList);
    const config = loadConfig();
    try {
      await runAuthTenantList(config, { emailOrUsername: args.email });
    } catch {
      this.exit(1);
    }
  }
}
