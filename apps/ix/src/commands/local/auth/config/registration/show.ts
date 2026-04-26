import { Command } from "@oclif/core";
import {
  loadConfig,
  runAuthConfigRegistrationShow,
} from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigRegistrationShow extends Command {
  static description = "Show current registration mode.";

  async run(): Promise<void> {
    const config = loadConfig();
    try {
      await runAuthConfigRegistrationShow(config);
    } catch {
      this.exit(1);
    }
  }
}
