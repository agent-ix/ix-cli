import { Args, Command } from "@oclif/core";
import { runTunnelDomainCommand } from "@agent-ix/ix-cli-local";

export default class TunnelDomain extends Command {
  static description =
    "Read or set the wildcard hostname the tunnel terminates (default: agent-ix.dev). With no argument, prints the current value.";

  static args = {
    value: Args.string({
      description:
        "New base domain (e.g. agent-ix.dev). Must be a fully-qualified domain with at least two labels. Must match the *.<value> CNAME you set in the Cloudflare zone.",
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TunnelDomain);
    try {
      await runTunnelDomainCommand(args.value ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
