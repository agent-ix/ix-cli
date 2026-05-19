import { FlowLine, Listing, blue, renderStatic } from "@agent-ix/ix-ui-cli";
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
        variant="flow"
        pre={<FlowLine>{`Removing tap ${blue(url)}`}</FlowLine>}
        tail={`Removed tap ${blue(url)}.`}
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
