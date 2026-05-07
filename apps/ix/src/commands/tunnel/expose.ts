import { Args, Command, Flags } from "@oclif/core";
import { runTunnelExposeCommand } from "@agent-ix/ix-cli-local";

export default class TunnelExpose extends Command {
  static description =
    "Add the tunnel base domain (e.g. <app>.agent-ix.dev) to a running app's ingress so cloudflared routes external traffic to it.";

  static args = {
    app: Args.string({
      description:
        "Name of the app or service whose release should be exposed.",
      required: true,
    }),
  };

  static flags = {
    hostname: Flags.string({
      description:
        "Override the auto-derived hostname (default: <app>.<tunnel.baseDomain>). Must end in the configured base domain or be a fully-qualified host you control.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TunnelExpose);
    try {
      await runTunnelExposeCommand(args.app, flags.hostname ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
