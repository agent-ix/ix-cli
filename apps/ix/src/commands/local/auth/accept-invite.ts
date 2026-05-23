import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthAcceptInvite } from "@agent-ix/ix-cli-local";

/**
 * FR-040 — `ix local auth accept-invite <token>`
 *
 * Headless consumption of an invite token. The `--password` flag is
 * intentionally absent (auth/FR-008-CON-11 strengthened wording forbids
 * passwords in argv); operators MUST use `--password-stdin` or `--generate`.
 */
export default class LocalAuthAcceptInvite extends BaseCommand {
  static description =
    "Accept an invite token headlessly (consumes the token and sets the user's password).";

  static examples = [
    "ix local auth accept-invite <token> --password-stdin",
    "ix local auth accept-invite <token> --generate --show-generated",
  ];

  static args = {
    token: Args.string({
      required: true,
      description: "The invite token (single-use).",
    }),
  };

  static flags = {
    "password-stdin": Flags.boolean({
      default: false,
      description: "Read the new password from stdin.",
    }),
    generate: Flags.boolean({
      default: false,
      description:
        "Generate a strong random password (32 chars). Not printed unless --show-generated is set.",
    }),
    "show-generated": Flags.boolean({
      default: false,
      description:
        "Print the generated password to stderr after success. Implies --generate.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthAcceptInvite);
    const config = loadConfig();
    try {
      await runAuthAcceptInvite(config, args.token, {
        passwordStdin: flags["password-stdin"],
        generate: flags.generate || flags["show-generated"],
        showGenerated: flags["show-generated"],
      });
    } catch {
      this.exit(1);
    }
  }
}
