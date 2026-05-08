import {
  GLYPH_DIM_DOT,
  Listing,
  Text,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";
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
        pre={<Text>{` ${GLYPH_DIM_DOT} Removing tap ${blue(url)}`}</Text>}
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
