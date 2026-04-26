import { Command } from "@oclif/core";
import { loadConfig, runAuthInit } from "@agent-ix/ix-cli-local";

export default class LocalInit extends Command {
  static description =
    "Bootstrap the initial admin account in the identity service.";

  async run(): Promise<void> {
    const config = loadConfig();
    try {
      await runAuthInit(config);
    } catch {
      this.exit(1);
    }
  }
}
