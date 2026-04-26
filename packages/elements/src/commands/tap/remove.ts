import { introCommand, outroSuccess, outroError } from "@agent-ix/ix-ui-cli";
import { removeTap } from "../../tap-config.js";
import { invalidateCache } from "../../registry/cache.js";

export async function runTapRemove(url: string): Promise<void> {
  introCommand("ix elements tap remove");
  try {
    removeTap(url);
    invalidateCache(url);
    outroSuccess(`Removed tap: ${url}`);
  } catch (err) {
    outroError(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
