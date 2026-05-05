import React from "react";
import { Listing, renderStatic } from "@agent-ix/ix-ui-cli";
import { removeTap } from "../../tap-config.js";
import { invalidateCache } from "../../registry/cache.js";

export async function runTapRemove(url: string): Promise<void> {
  try {
    removeTap(url);
    invalidateCache(url);
    await renderStatic(
      <Listing
        header="ix elements tap remove"
        status="passed"
        tail={`Removed tap: ${url}`}
      />,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header="ix elements tap remove"
        status="failed"
        tail={`Failed: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  }
}
