import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import {
  loadConfig,
  runAuthConfigPasswordResetSet,
} from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigPasswordResetSet extends BaseCommand {
  static description = "Set password reset mode: cli_only | email | disabled.";

  static args = {
    mode: Args.string({
      required: true,
      description: "Mode: cli_only | email | disabled.",
    }),
  };

  static flags = {
    "rollout-timeout": Flags.integer({
      description: "Rollout timeout in seconds (default: 120).",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthConfigPasswordResetSet);
    const config = loadConfig();
    try {
      await runAuthConfigPasswordResetSet(config, args.mode, {
        rolloutTimeout: flags["rollout-timeout"],
      });
    } catch {
      this.exit(1);
    }
  }
}
