import React from "react";
import { Listing, Item, renderStatic } from "@agent-ix/ix-ui-cli";
import { loadTapConfig, ROOT_TAP } from "../../tap-config.js";

export async function runTapList(): Promise<void> {
  const { taps } = loadTapConfig();
  await renderStatic(
    <Listing
      header="ix elements tap list"
      status="passed"
      tail={`${taps.length} tap(s) configured.`}
    >
      {taps.map((tap) => (
        <Item
          key={tap}
          name={tap}
          description={tap === ROOT_TAP ? "(root)" : undefined}
        />
      ))}
    </Listing>,
  );
}
