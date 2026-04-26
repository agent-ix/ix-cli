import { Command } from "@oclif/core";
import { loadConfig, runAuthConfigEmailShow } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigEmailShow extends Command {
  static description = "Show current email config (password is never printed).";

  async run(): Promise<void> {
    const config = loadConfig();
    try {
      await runAuthConfigEmailShow(config);
    } catch {
      this.exit(1);
    }
  }
}
