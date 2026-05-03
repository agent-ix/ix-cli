import { Command } from "@oclif/core";
import { runSecretsList } from "@agent-ix/ix-cli-core";

export default class SecretsList extends Command {
  static description =
    "List declared plugin secrets with backend and current resolution source. Never renders values.";

  async run(): Promise<void> {
    try {
      await runSecretsList();
    } catch (err) {
      this.log(err instanceof Error ? err.message : String(err));
      this.exit(1);
    }
  }
}
