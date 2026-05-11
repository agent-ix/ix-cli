import { Args } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runTunnelUnexposeCommand } from "@agent-ix/ix-cli-local";

export default class TunnelUnexpose extends BaseCommand {
  static description =
    "Remove an app from tunnel exposure. Clears tunnel.exposed[<app>] and updates the helm release so the public host is no longer served. LAN hosts (e.g. *.dev.ix, *.luna.ix) keep working.";

  static args = {
    app: Args.string({
      description:
        "Name of the app or service whose release should be unexposed.",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TunnelUnexpose);
    try {
      await runTunnelUnexposeCommand(args.app);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
