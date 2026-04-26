import { Command, Flags } from "@oclif/core";
import {
  loadConfig,
  loadClusterConfig,
  runClusterUp,
} from "@agent-ix/ix-cli-local";

export default class LocalClusterUp extends Command {
  static description =
    "Bootstrap the kind cluster and deploy all ix-core tagged apps.";

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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalClusterUp);
    const config = loadConfig();
    const clusterConfig = loadClusterConfig();
    try {
      await runClusterUp(config, clusterConfig, {
        reconfigureCredentials: flags["reconfigure-credentials"],
        includeTags: flags["include-tag"] ? [flags["include-tag"]] : undefined,
        excludeTags: flags["exclude-tag"] ? [flags["exclude-tag"]] : undefined,
      });
    } catch {
      this.exit(1);
    }
  }
}
