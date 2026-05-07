import { Args, Command } from "@oclif/core";
import { runTunnelUnexposeCommand } from "@agent-ix/ix-cli-local";

export default class TunnelUnexpose extends Command {
  static description =
    "Remove the tunnel base domain from an app's ingress. The app remains reachable on internal hosts (e.g. *.dev.ix).";

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
