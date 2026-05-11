import { Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runList } from "@agent-ix/ix-cli-local";

export default class LocalList extends BaseCommand {
  static description =
    "List deployable apps and services from the OCI registry.";

  static flags = {
    refresh: Flags.boolean({
      description: "Bypass local cache and re-query the registry.",
    }),
    role: Flags.string({
      description: "Filter to 'app' or 'service'.",
      options: ["app", "service"],
    }),
    category: Flags.string({ description: "Filter by category." }),
    tag: Flags.string({ description: "Filter to deployables with this tag." }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalList);
    const config = loadConfig();
    try {
      await runList(config, {
        refresh: flags.refresh,
        role: flags.role as "app" | "service" | undefined,
        category: flags.category,
        tag: flags.tag,
      });
    } catch {
      this.exit(1);
    }
  }
}
