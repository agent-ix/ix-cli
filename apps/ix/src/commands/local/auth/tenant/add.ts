import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthTenantAdd } from "@agent-ix/ix-cli-local";

export default class LocalAuthTenantAdd extends BaseCommand {
  static description = "Add a tenant membership to a user (FR-042).";

  static args = {
    email: Args.string({
      required: true,
      description: "User email or username.",
    }),
  };

  static flags = {
    tenant: Flags.string({
      required: true,
      description: "Tenant UUID.",
    }),
    role: Flags.string({
      default: "member",
      options: ["member", "admin", "owner"],
      description: "Role to grant within the tenant.",
    }),
    "is-default": Flags.boolean({
      default: false,
      description:
        "Atomically promote this membership to the user's default tenant.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthTenantAdd);
    const config = loadConfig();
    try {
      await runAuthTenantAdd(config, {
        emailOrUsername: args.email,
        tenantId: flags.tenant,
        role: flags.role as "member" | "admin" | "owner",
        isDefault: flags["is-default"],
      });
    } catch {
      this.exit(1);
    }
  }
}
