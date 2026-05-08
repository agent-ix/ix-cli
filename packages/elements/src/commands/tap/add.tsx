import {
  GLYPH_DIM_DOT,
  Listing,
  Text,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";
import { addTap } from "../../tap-config.js";
import { invalidateCache } from "../../registry/cache.js";

export async function runTapAdd(url: string): Promise<void> {
  try {
    const added = addTap(url);
    if (!added) {
      await renderStatic(
        <Listing
          header="ix elements tap add"
          status="passed"
          variant="flow"
          pre={<Text>{` ${GLYPH_DIM_DOT} Adding tap ${blue(url)}`}</Text>}
          tail={`Tap ${blue(url)} is already configured.`}
        />,
      );
      return;
    }
    invalidateCache(url);
    await renderStatic(
      <Listing
        header="ix elements tap add"
        status="passed"
        variant="flow"
        pre={<Text>{` ${GLYPH_DIM_DOT} Adding tap ${blue(url)}`}</Text>}
        tail={`Added tap ${blue(url)}.`}
      />,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header="ix elements tap add"
        status="failed"
        tail={`Failed: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  }
}
