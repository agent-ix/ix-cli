/**
 * FR-007 — `ix-local list` — show all discovered deployables.
 */

import Table from "cli-table3";
import pc from "picocolors";
import type { IxConfig } from "../config.js";
import { resolveGhcrToken } from "../credentials.js";
import { loadRegistry } from "../registry.js";
import type { Deployable } from "../discovery.js";
import { introCommand, outroSuccess, outroWarning } from "@agent-ix/ix-ui-cli";

export interface ListOptions {
  refresh?: boolean;
  category?: string;
  tag?: string;
  role?: "app" | "service";
}

function group(deployables: Deployable[]): Map<string, Deployable[]> {
  const out = new Map<string, Deployable[]>();
  for (const d of deployables) {
    const key = d.category ?? "uncategorized";
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(d);
  }
  for (const arr of out.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

export async function runList(
  config: IxConfig,
  opts: ListOptions,
): Promise<void> {
  introCommand("ix local list");

  const token = config.ghcrToken?.trim() || (await resolveGhcrToken(false));

  const deployables = await loadRegistry({
    org: config.org,
    githubToken: token,
    refresh: opts.refresh ?? false,
  });

  let filtered = deployables;
  if (opts.role) filtered = filtered.filter((d) => d.role === opts.role);
  if (opts.category)
    filtered = filtered.filter((d) => d.category === opts.category);
  if (opts.tag) filtered = filtered.filter((d) => d.tags.includes(opts.tag!));

  if (filtered.length === 0) {
    outroWarning("No deployables found.");
    return;
  }

  const grouped = group(filtered);
  const categories = [...grouped.keys()].sort();

  for (const cat of categories) {
    process.stdout.write(pc.bold(pc.cyan(`\n${cat}`)) + "\n");
    const table = new Table({
      head: ["name", "type", "version", "title", "tags"],
      style: { head: ["dim"] },
    });
    for (const d of grouped.get(cat)!) {
      table.push([d.name, d.role, d.version, d.title ?? "", d.tags.join(",")]);
    }
    process.stdout.write(table.toString() + "\n");
  }

  outroSuccess(`${filtered.length} deployable(s)`);
}
