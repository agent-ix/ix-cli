import { Args, Command } from "@oclif/core";
import { runSecretsSet } from "@agent-ix/ix-cli-core";

export default class SecretsSet extends Command {
  static description = "Set a secret via masked-input prompt.";
  static examples = ["ix secrets set local.ghcr-token"];

  static args = {
    id: Args.string({
      required: true,
      description: "Secret id in <plugin>.<name> form, e.g. local.ghcr-token",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SecretsSet);
    try {
      await runSecretsSet(args.id);
    } catch (err) {
      this.log(err instanceof Error ? err.message : String(err));
      this.exit(1);
    }
  }
}
