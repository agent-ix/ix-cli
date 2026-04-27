import { startListing } from "@agent-ix/ix-ui-cli";
import { resolveAllElements } from "../registry/resolver.js";

export async function runElementsList(
  opts: { refresh?: boolean } = {},
): Promise<void> {
  const list = startListing("ix elements list");
  try {
    const elements = await resolveAllElements(opts);

    if (elements.length === 0) {
      list.success(
        "No elements found. Add a tap with `ix elements tap add <github-url>`.",
      );
      return;
    }

    const byTap = new Map<string, typeof elements>();
    for (const el of elements) {
      const group = byTap.get(el.tap) ?? [];
      group.push(el);
      byTap.set(el.tap, group);
    }

    for (const [tap, entries] of byTap) {
      list.group(tap);
      for (const entry of entries) {
        list.item(entry.type, entry.description);
      }
    }

    list.success(`${elements.length} element type(s) available.`);
  } catch (err) {
    list.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
