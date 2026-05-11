import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runConfigDoctor } from "@agent-ix/ix-cli-core";

export default class ConfigDoctor extends BaseCommand {
  static description =
    "Validate every plugin's config file against its schema. Exits non-zero if any plugin fails validation.";

  async run(): Promise<void> {
    const { exitCode } = await runConfigDoctor();
    if (exitCode !== 0) this.exit(exitCode);
  }
}
