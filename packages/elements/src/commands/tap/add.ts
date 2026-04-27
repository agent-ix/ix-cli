import { startListing } from "@agent-ix/ix-ui-cli";
import { addTap } from "../../tap-config.js";
import { invalidateCache } from "../../registry/cache.js";

export async function runTapAdd(url: string): Promise<void> {
  const list = startListing("ix elements tap add");
  try {
    const added = addTap(url);
    if (!added) {
      list.success(`Tap '${url}' is already configured.`);
      return;
    }
    invalidateCache(url);
    list.success(`Added tap: ${url}`);
  } catch (err) {
    list.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
