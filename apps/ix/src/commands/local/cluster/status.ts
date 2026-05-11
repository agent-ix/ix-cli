import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runClusterStatus } from "@agent-ix/ix-cli-local";

export default class LocalClusterStatus extends BaseCommand {
  static description = "Show cluster node health and unhealthy pods.";

  async run(): Promise<void> {
    try {
      await runClusterStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
