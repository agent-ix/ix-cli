import { Command, Flags } from "@oclif/core";
import { loadConfig, runClusterDown } from "@agent-ix/ix-cli-local";

export default class LocalClusterDown extends Command {
  static description =
    "Destroy the local kind cluster. Two-stage confirmation guards against accidents.";

  static flags = {
    yes: Flags.boolean({
      char: "y",
      description: "Skip both confirmation prompts.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalClusterDown);
    const config = loadConfig();
    try {
      await runClusterDown(config, { yes: flags.yes });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
