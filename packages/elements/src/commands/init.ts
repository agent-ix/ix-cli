import { runElementsInit, type ScaffoldOptions } from "../scaffold.js";

export async function runInit(
  type: string,
  name: string,
  opts: ScaffoldOptions = {},
): Promise<void> {
  // scaffold.ts owns its own startListing frame; just propagate failures.
  await runElementsInit(type, name, opts);
}
