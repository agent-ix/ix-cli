import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runTunnelExposeCommand } from "@agent-ix/ix-cli-local";

export default class TunnelExpose extends BaseCommand {
  static description =
    "Expose a running app on the tunnel base domain (e.g. <app>.agent-ix.dev). Records intent in tunnel.exposed so exposure survives `ix down` + `ix up`. Idempotent.";

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
