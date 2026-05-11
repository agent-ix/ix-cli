import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runClusterStatus } from "@agent-ix/ix-cli-local";

export default class LocalStatus extends BaseCommand {
  static description = "Show cluster node health and unhealthy pods.";

  async run(): Promise<void> {
    try {
      await runClusterStatus();
    } catch {
      this.exit(1);
    }
  }
}
