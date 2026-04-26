import { Command, Flags } from "@oclif/core";
import { loadConfig, runClusterDown } from "@agent-ix/ix-cli-local";

export default class LocalClusterDown extends Command {
  static description =
    "Delete the kind cluster and all its state (requires confirmation).";

  static flags = {
    yes: Flags.boolean({
      description: "Skip confirmation prompt (for scripting).",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalClusterDown);
    const config = loadConfig();
    try {
      await runClusterDown(config, { yes: flags.yes });
    } catch {
      this.exit(1);
    }
  }
}
