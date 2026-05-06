import { Command } from "@oclif/core";
import { loadConfig, runClusterStop } from "@agent-ix/ix-cli-local";

export default class LocalClusterStop extends Command {
  static description =
    "Pause the local kind cluster (docker stop on node containers). Preserves PVC data.";

  async run(): Promise<void> {
    const config = loadConfig();
    try {
      await runClusterStop(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
