import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthCreateUser } from "@agent-ix/ix-cli-local";

/**
 * FR-043 — `ix local auth create-user <email>`
 *
 * Composite orchestrator: invite → accept-invite → optional agent-browser
 * vault save. Per auth/FR-008-CON-11 the new password is generated locally
 * by default; `--password-stdin` opts into a caller-supplied password.
 */
export default class LocalAuthCreateUser extends BaseCommand {
  static description =
    "Create a user end-to-end: invite, accept-invite, and (optionally) save to the agent-browser vault.";

  static examples = [
    "ix local auth create-user testbot@agent-ix.local --tenant <tenant-uuid>",
    "ix local auth create-user testbot@agent-ix.local --tenant <id> --no-save-vault",
  ];

  static args = {
    email: Args.string({
      required: true,
      description: "Target email.",
    }),
  };

  static flags = {
    tenant: Flags.string({
      required: true,
      description: "Tenant UUID the new user belongs to.",
    }),
    username: Flags.string({
      description: "Username (defaults to the local part of the email).",
    }),
    "display-name": Flags.string({
      description: "Display name.",
    }),
    "password-stdin": Flags.boolean({
      default: false,
      description:
        "Read the new password from stdin. Without this flag the command generates a strong random password.",
    }),
    "vault-name": Flags.string({
      description:
        "Name to use when saving the credential to agent-browser. Defaults to the local part of the email.",
    }),
    "no-save-vault": Flags.boolean({
      default: false,
      description:
        "Skip the agent-browser vault save even if `agent-browser` is on PATH.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthCreateUser);
    const config = loadConfig();
    try {
      await runAuthCreateUser(config, args.email, {
        tenantId: flags.tenant,
        username: flags.username,
        displayName: flags["display-name"],
        passwordStdin: flags["password-stdin"],
        vaultName: flags["vault-name"],
        noSaveVault: flags["no-save-vault"],
      });
    } catch {
      this.exit(1);
    }
  }
}
