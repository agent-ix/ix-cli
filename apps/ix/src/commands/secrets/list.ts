import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runSecretsList } from "@agent-ix/ix-cli-core";

export default class SecretsList extends BaseCommand {
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
