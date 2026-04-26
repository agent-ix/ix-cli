import { Command, Flags } from "@oclif/core";
import { loadConfig, runInitCluster } from "@agent-ix/ix-cli-local";

export default class LocalInitCluster extends Command {
  static description =
    "Bootstrap a local kind cluster (dev/demo/alpha/beta only).";

  static flags = {
    "reconfigure-credentials": Flags.boolean({
      description: "Force re-prompt for GHCR credentials even if stored.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalInitCluster);
    const config = loadConfig();
    try {
      await runInitCluster(config, flags["reconfigure-credentials"] ?? false);
    } catch {
      this.exit(1);
    }
  }
}
