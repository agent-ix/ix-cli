import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthTenantSetDefault } from "@agent-ix/ix-cli-local";

export default class LocalAuthTenantSetDefault extends BaseCommand {
  static description = "Promote a tenant membership to default (FR-042).";

  static args = {
    email: Args.string({
      required: true,
      description: "User email or username.",
    }),
  };

  static flags = {
    tenant: Flags.string({
      required: true,
      description: "Tenant UUID to mark as default.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthTenantSetDefault);
    const config = loadConfig();
    try {
      await runAuthTenantSetDefault(config, {
        emailOrUsername: args.email,
        tenantId: flags.tenant,
      });
    } catch {
      this.exit(1);
    }
  }
}
