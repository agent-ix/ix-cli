/**
 * FR-007 — `ix-local list` — show all discovered deployables.
 */

import React from "react";
import Table from "cli-table3";
import { Box, Text } from "ink";
import type { IxConfig } from "../config.js";
import { resolveGhcrToken } from "../credentials.js";
import { loadRegistry } from "../registry.js";
import type { Deployable } from "../discovery.js";
import { Listing, Group, renderStatic } from "@agent-ix/ix-ui-cli";

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
  const token = await resolveGhcrToken(false);

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
    await renderStatic(
      <Listing
        header="ix local list"
        status="passed"
        tail="No deployables found."
        tailVariant="warn"
      />,
    );
    return;
  }

  const grouped = group(filtered);
  const categories = [...grouped.keys()].sort();

  await renderStatic(
    <Listing
      header="ix local list"
      status="passed"
      tail={`${filtered.length} deployable(s)`}
    >
      {categories.map((cat) => {
        const table = new Table({
          head: ["name", "type", "version", "title", "tags"],
          style: { head: ["dim"] },
        });
        for (const d of grouped.get(cat)!) {
          table.push([
            d.name,
            d.role,
            d.version,
            d.title ?? "",
            d.tags.join(","),
          ]);
        }
        return (
          <Group key={cat} name={cat}>
            <Box flexDirection="column">
              <Text>{table.toString()}</Text>
            </Box>
          </Group>
        );
      })}
    </Listing>,
  );
}
