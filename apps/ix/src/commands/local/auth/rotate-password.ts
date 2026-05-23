import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthRotatePassword } from "@agent-ix/ix-cli-local";

/**
 * FR-041 — `ix local auth rotate-password <email>`
 *
 * Drives the must_rotate flow headlessly. Two kubectlRaw calls in sequence:
 *   1) auth-service `POST /token` (grant_type=password) → rotate-scoped JWT
 *   2) identity `POST /users/me/password/rotate` with Bearer + new_password
 *
 * Per auth/FR-008-CON-11, neither the current nor the new password may
 * appear in argv; use --current-password-stdin / --new-password-stdin /
 * --generate.
 */
export default class LocalAuthRotatePassword extends BaseCommand {
  static description =
    "Force-rotate a user's password using their temporary credential (must_rotate flow).";

  static examples = [
    "ix local auth rotate-password alice@example.com --current-password-stdin --generate --show-generated",
  ];

  static args = {
    email: Args.string({
      required: true,
      description: "Target user email or username.",
    }),
  };

  static flags = {
    "current-password-stdin": Flags.boolean({
      default: false,
      description:
        "Read the current (temporary) password from stdin (first line).",
    }),
    "new-password-stdin": Flags.boolean({
      default: false,
      description: "Read the new password from stdin (second line).",
    }),
    generate: Flags.boolean({
      default: false,
      description:
        "Generate a strong random new password (32 chars). Not printed unless --show-generated.",
    }),
    "show-generated": Flags.boolean({
      default: false,
      description:
        "Print the generated new password to stderr after success. Implies --generate.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthRotatePassword);
    const config = loadConfig();
    try {
      await runAuthRotatePassword(config, args.email, {
        currentPasswordStdin: flags["current-password-stdin"],
        newPasswordStdin: flags["new-password-stdin"],
        generate: flags.generate || flags["show-generated"],
        showGenerated: flags["show-generated"],
      });
    } catch {
      this.exit(1);
    }
  }
}
