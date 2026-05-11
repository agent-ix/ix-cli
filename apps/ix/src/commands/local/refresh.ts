import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runRefresh } from "@agent-ix/ix-cli-local";

export default class LocalRefresh extends BaseCommand {
  static description = "Force-refresh the local deployable registry cache.";

  async run(): Promise<void> {
    const config = loadConfig();
    try {
      await runRefresh(config);
    } catch {
      this.exit(1);
    }
  }
}
