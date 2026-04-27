import { startListing } from "@agent-ix/ix-ui-cli";
import { removeTap } from "../../tap-config.js";
import { invalidateCache } from "../../registry/cache.js";

export async function runTapRemove(url: string): Promise<void> {
  const list = startListing("ix elements tap remove");
  try {
    removeTap(url);
    invalidateCache(url);
    list.success(`Removed tap: ${url}`);
  } catch (err) {
    list.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
