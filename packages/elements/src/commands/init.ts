import { runElementsInit, type ScaffoldOptions } from "../scaffold.js";
import { outroError } from "@agent-ix/ix-ui-cli";

export async function runInit(
  type: string,
  name: string,
  opts: ScaffoldOptions = {},
): Promise<void> {
  try {
    await runElementsInit(type, name, opts);
  } catch (err) {
    outroError(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
