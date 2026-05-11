import { Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runClusterRefreshCert } from "@agent-ix/ix-cli-local";

export default class LocalClusterRefreshCert extends BaseCommand {
  static description =
    "Re-issue the cluster wildcard + ingress TLS certs to cover the currently-configured domain.hosts. Use after changing `domain.hosts`.";

  static flags = {
    "if-needed": Flags.boolean({
      description:
        "Only re-issue if the existing cert is missing or does not cover every configured host.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalClusterRefreshCert);
    const config = loadConfig();
    try {
      await runClusterRefreshCert(config, { ifNeeded: flags["if-needed"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
