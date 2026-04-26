import { Command } from "@oclif/core";
import {
  loadConfig,
  runAuthConfigPasswordResetShow,
} from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigPasswordResetShow extends Command {
  static description = "Show current password reset mode.";

  async run(): Promise<void> {
    const config = loadConfig();
    try {
      await runAuthConfigPasswordResetShow(config);
    } catch {
      this.exit(1);
    }
  }
}
