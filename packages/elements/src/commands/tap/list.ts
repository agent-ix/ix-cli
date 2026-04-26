import pc from "picocolors";
import { introCommand, outroSuccess } from "@agent-ix/ix-ui-cli";
import { loadTapConfig, ROOT_TAP } from "../../tap-config.js";

export function runTapList(): void {
  introCommand("ix elements tap list");
  const { taps } = loadTapConfig();
  for (const tap of taps) {
    const suffix = tap === ROOT_TAP ? pc.dim(" (root)") : "";
    process.stdout.write(`  ${pc.cyan(tap)}${suffix}\n`);
  }
  outroSuccess(`${taps.length} tap(s) configured.`);
}
