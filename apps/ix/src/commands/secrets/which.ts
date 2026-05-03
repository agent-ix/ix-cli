import { Args, Command } from "@oclif/core";
import { runSecretsWhich } from "@agent-ix/ix-cli-core";

export default class SecretsWhich extends Command {
  static description =
    "Report which source ix is currently resolving a secret from (env / keyring / age-file / unset).";
  static examples = ["ix secrets which local.ghcr-token"];

  static args = {
    id: Args.string({
      required: true,
      description: "Secret id in <plugin>.<name> form.",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SecretsWhich);
    try {
      await runSecretsWhich(args.id);
    } catch (err) {
      this.log(err instanceof Error ? err.message : String(err));
      this.exit(1);
    }
  }
}
