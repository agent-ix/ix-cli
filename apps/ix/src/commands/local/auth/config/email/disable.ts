import { Command, Flags } from "@oclif/core";
import { loadConfig, runAuthConfigEmailDisable } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigEmailDisable extends Command {
  static description = "Disable email.";

  static flags = {
    "rollout-timeout": Flags.integer({
      description: "Rollout timeout in seconds (default: 120).",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalAuthConfigEmailDisable);
    const config = loadConfig();
    try {
      await runAuthConfigEmailDisable(config, {
        rolloutTimeout: flags["rollout-timeout"],
      });
    } catch {
      this.exit(1);
    }
  }
}
