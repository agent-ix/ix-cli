import React from "react";
import {
  Listing,
  Group,
  Item,
  renderStatic,
} from "@agent-ix/ix-ui-cli";
import { resolveAllElements } from "../registry/resolver.js";

export async function runElementsList(
  opts: { refresh?: boolean } = {},
): Promise<void> {
  let elements: Awaited<ReturnType<typeof resolveAllElements>>;
  try {
    elements = await resolveAllElements(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header="ix elements list"
        status="failed"
        tail={`Failed: ${msg}`}
        tailVariant="error"
      />,
    );
    throw err;
  }

  if (elements.length === 0) {
    await renderStatic(
      <Listing
        header="ix elements list"
        status="passed"
        tail="No elements found. Add a tap with `ix elements tap add <github-url>`."
      />,
    );
    return;
  }

  const byTap = new Map<string, typeof elements>();
  for (const el of elements) {
    const group = byTap.get(el.tap) ?? [];
    group.push(el);
    byTap.set(el.tap, group);
  }

  await renderStatic(
    <Listing
      header="ix elements list"
      status="passed"
      tail={`${elements.length} element type(s) available.`}
    >
      {Array.from(byTap.entries()).map(([tap, entries]) => (
        <Group key={tap} name={tap}>
          {entries.map((entry) => (
            <Item
              key={entry.type}
              name={entry.type}
              description={entry.description}
            />
          ))}
        </Group>
      ))}
    </Listing>,
  );
}
