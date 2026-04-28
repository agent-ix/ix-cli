import { Command, Flags } from "@oclif/core";
import {
  loadConfig,
  loadClusterConfig,
  runClusterUp,
  runAuthInit,
} from "@agent-ix/ix-cli-local";

export default class LocalInit extends Command {
  static description =
    "Bootstrap the cluster, deploy ix-core services, and initialize the admin account.";

  static flags = {
    "reconfigure-credentials": Flags.boolean({
      description: "Force re-prompt for GHCR credentials even if stored.",
    }),
    "include-tag": Flags.string({
      description:
        "Override defaultTags for this run — only deploy apps carrying this tag.",
    }),
    "exclude-tag": Flags.string({
      description:
        "Exclude apps carrying this tag from the effective deploy set.",
    }),
    "skip-auth": Flags.boolean({
      description: "Skip admin account initialization.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalInit);
    const config = loadConfig();
    const clusterConfig = loadClusterConfig();
    try {
      await runClusterUp(config, clusterConfig, {
        reconfigureCredentials: flags["reconfigure-credentials"],
        includeTags: flags["include-tag"] ? [flags["include-tag"]] : undefined,
        excludeTags: flags["exclude-tag"] ? [flags["exclude-tag"]] : undefined,
      });
      if (!flags["skip-auth"]) {
        process.stdout.write("\n");
        await runAuthInit(config);
      }
    } catch {
      this.exit(1);
    }
  }
}
