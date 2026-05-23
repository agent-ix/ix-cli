import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthTenantRemove } from "@agent-ix/ix-cli-local";

export default class LocalAuthTenantRemove extends BaseCommand {
  static description = "Soft-delete a user's tenant membership (FR-042).";

  static args = {
    email: Args.string({
      required: true,
      description: "User email or username.",
    }),
  };

  static flags = {
    tenant: Flags.string({
      required: true,
      description: "Tenant UUID to remove.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthTenantRemove);
    const config = loadConfig();
    try {
      await runAuthTenantRemove(config, {
        emailOrUsername: args.email,
        tenantId: flags.tenant,
      });
    } catch {
      this.exit(1);
    }
  }
}
