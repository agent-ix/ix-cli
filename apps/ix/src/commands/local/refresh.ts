import { Command } from "@oclif/core";
import {
  loadConfig,
  loadRegistry,
  resolveGhcrToken,
} from "@agent-ix/ix-cli-local";
import { log } from "@agent-ix/ix-ui-cli";

export default class LocalRefresh extends Command {
  static description = "Force-refresh the local deployable registry cache.";

  async run(): Promise<void> {
    const config = loadConfig();
    try {
      const token = config.ghcrToken?.trim() || (await resolveGhcrToken(false));
      const reg = await loadRegistry({
        org: config.org,
        githubToken: token,
        refresh: true,
      });
      log.info(`Refreshed registry: ${reg.length} deployable(s).`);
    } catch {
      this.exit(1);
    }
  }
}
