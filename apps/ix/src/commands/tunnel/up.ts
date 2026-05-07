import { Command } from "@oclif/core";
import { runTunnelUpCommand } from "@agent-ix/ix-cli-local";

export default class TunnelUp extends Command {
  static description =
    "Install/upgrade the shared cloudflared tunnel. Requires a Cloudflare token (IX_CF_TUNNEL_TOKEN env or `ix secrets set cloudflare-tunnel-token`).";

  async run(): Promise<void> {
    try {
      await runTunnelUpCommand();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
