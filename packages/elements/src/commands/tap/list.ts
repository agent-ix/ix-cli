import { startListing } from "@agent-ix/ix-ui-cli";
import { loadTapConfig, ROOT_TAP } from "../../tap-config.js";

export function runTapList(): void {
  const list = startListing("ix elements tap list");
  const { taps } = loadTapConfig();
  for (const tap of taps) {
    list.item(tap, tap === ROOT_TAP ? "(root)" : undefined);
  }
  list.success(`${taps.length} tap(s) configured.`);
}
