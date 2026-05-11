import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runSecretsRm } from "@agent-ix/ix-cli-core";

export default class SecretsRm extends BaseCommand {
  static description = "Remove a secret from the active backend.";
  static examples = [
    "ix secrets rm local.ghcr-token",
    "ix secrets rm local.ghcr-token --strict",
  ];

  static args = {
    id: Args.string({
      required: true,
      description: "Secret id in <plugin>.<name> form, e.g. local.ghcr-token",
    }),
  };

  static flags = {
    strict: Flags.boolean({
      description:
        "Exit non-zero when an env var still satisfies get() after removal.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SecretsRm);
    try {
      const { exitCode } = await runSecretsRm(args.id, {
        strict: flags.strict,
      });
      if (exitCode !== 0) this.exit(exitCode);
    } catch (err) {
      this.log(err instanceof Error ? err.message : String(err));
      this.exit(1);
    }
  }
}
