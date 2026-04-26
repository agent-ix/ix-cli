import { introCommand, outroSuccess, outroError } from "@agent-ix/ix-ui-cli";
import { addTap } from "../../tap-config.js";
import { invalidateCache } from "../../registry/cache.js";

export async function runTapAdd(url: string): Promise<void> {
  introCommand("ix elements tap add");
  try {
    const added = addTap(url);
    if (!added) {
      outroSuccess(`Tap '${url}' is already configured.`);
      return;
    }
    invalidateCache(url);
    outroSuccess(`Added tap: ${url}`);
  } catch (err) {
    outroError(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
