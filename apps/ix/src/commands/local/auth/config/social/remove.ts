import { Args, Command, Flags } from "@oclif/core";
import { loadConfig, runAuthConfigSocialRemove } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigSocialRemove extends Command {
  static description = "Remove a social provider.";

  static args = {
    id: Args.string({ required: true, description: "Provider ID to remove." }),
  };

  static flags = {
    "rollout-timeout": Flags.integer({
      description: "Rollout timeout in seconds (default: 120).",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthConfigSocialRemove);
    const config = loadConfig();
    try {
      await runAuthConfigSocialRemove(config, args.id, {
        rolloutTimeout: flags["rollout-timeout"],
      });
    } catch {
      this.exit(1);
    }
  }
}
