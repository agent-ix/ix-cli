import { Args, Command, Flags } from "@oclif/core";
import {
  loadConfig,
  runAuthConfigRegistrationSet,
} from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigRegistrationSet extends Command {
  static description =
    "Set registration mode: closed | invite_only | admin_approved | self_service.";

  static args = {
    mode: Args.string({
      required: true,
      description:
        "Mode: closed | invite_only | admin_approved | self_service.",
    }),
  };

  static flags = {
    "rollout-timeout": Flags.integer({
      description: "Rollout timeout in seconds (default: 120).",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthConfigRegistrationSet);
    const config = loadConfig();
    try {
      await runAuthConfigRegistrationSet(config, args.mode, {
        rolloutTimeout: flags["rollout-timeout"],
      });
    } catch {
      this.exit(1);
    }
  }
}
