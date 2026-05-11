import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runClusterStart } from "@agent-ix/ix-cli-local";

export default class LocalClusterStart extends BaseCommand {
  static description =
    "Resume the local kind cluster (docker start on node containers, then wait for the API server).";

  async run(): Promise<void> {
    const config = loadConfig();
    try {
      await runClusterStart(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
