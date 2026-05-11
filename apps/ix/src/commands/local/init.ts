import { Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import {
  loadConfig,
  loadClusterConfig,
  runClusterUp,
  runAuthInit,
  runUp,
} from "@agent-ix/ix-cli-local";

export default class LocalInit extends BaseCommand {
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
      const effectiveClusterConfig = {
        ...clusterConfig,
        skipApps: flags["skip-auth"]
          ? clusterConfig.skipApps
          : Array.from(new Set([...clusterConfig.skipApps, "auth"])),
      };
      await runClusterUp(config, effectiveClusterConfig, {
        reconfigureCredentials: flags["reconfigure-credentials"],
        includeTags: flags["include-tag"] ? [flags["include-tag"]] : undefined,
        excludeTags: flags["exclude-tag"] ? [flags["exclude-tag"]] : undefined,
      });
      if (!flags["skip-auth"]) {
        process.stdout.write("\n");
        await runUp(["auth"]);
        process.stdout.write("\n");
        await runAuthInit(config, undefined, { bootstrapIfMissing: false });
      }
    } catch {
      this.exit(1);
    }
  }
}
