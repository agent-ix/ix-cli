import { Command } from "@oclif/core";
import { runTunnelDownCommand } from "@agent-ix/ix-cli-local";

export default class TunnelDown extends Command {
  static description =
    "Uninstall the shared cloudflared tunnel. Idempotent. Apps remain reachable on internal hosts.";

  async run(): Promise<void> {
    try {
      await runTunnelDownCommand();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}
