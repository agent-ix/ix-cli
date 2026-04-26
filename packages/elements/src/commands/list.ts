import pc from "picocolors";
import { introCommand, outroSuccess, outroError } from "@agent-ix/ix-ui-cli";
import { resolveAllElements } from "../registry/resolver.js";

export async function runElementsList(
  opts: { refresh?: boolean } = {},
): Promise<void> {
  introCommand("ix elements list");
  try {
    const elements = await resolveAllElements(opts);

    if (elements.length === 0) {
      outroSuccess(
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
      process.stdout.write(`\n${pc.bold(pc.cyan(tap))}\n`);
      for (const entry of entries) {
        const desc = entry.description ? pc.dim(` — ${entry.description}`) : "";
        process.stdout.write(`  ${pc.green(entry.type)}${desc}\n`);
      }
    }

    outroSuccess(`${elements.length} element type(s) available.`);
  } catch (err) {
    outroError(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
