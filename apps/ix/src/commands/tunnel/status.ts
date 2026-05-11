import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runTunnelStatusCommand } from "@agent-ix/ix-cli-local";

export default class TunnelStatus extends BaseCommand {
  static description =
    "Report cloudflared install state and currently exposed app hosts under the tunnel base domain.";

  async run(): Promise<void> {
    try {
      await runTunnelStatusCommand();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
