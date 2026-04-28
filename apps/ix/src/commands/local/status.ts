import { Command } from "@oclif/core";
import { runClusterStatus } from "@agent-ix/ix-cli-local";

export default class LocalStatus extends Command {
  static description = "Show cluster node health and unhealthy pods.";

  async run(): Promise<void> {
    try {
      await runClusterStatus();
    } catch {
      this.exit(1);
    }
  }
}
