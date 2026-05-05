/**
 * FR-034 — Diff prior cache against freshly discovered deployables to produce
 * the per-chart rows shown by `ix local refresh`.
 */

import type { Deployable } from "./discovery.js";

export type RefreshChangeKind = "changed" | "added";

export interface RefreshChange {
  kind: RefreshChangeKind;
  role: Deployable["role"];
  displayName: string;
  oldVersion: string | null;
  newVersion: string;
}

function displayNameOf(d: Deployable): string {
  const t = d.title?.trim();
  return t && t.length > 0 ? t : d.name;
}

export function diffRegistry(
  prior: Deployable[] | null,
  fresh: Deployable[],
): RefreshChange[] {
  const priorByName = new Map<string, Deployable>();
  if (prior) {
    for (const d of prior) priorByName.set(d.name, d);
  }
  const out: RefreshChange[] = [];
  for (const d of fresh) {
    const old = priorByName.get(d.name);
    if (!old) {
      out.push({
        kind: "added",
        role: d.role,
        displayName: displayNameOf(d),
        oldVersion: null,
        newVersion: d.version,
      });
    } else if (old.version !== d.version) {
      out.push({
        kind: "changed",
        role: d.role,
        displayName: displayNameOf(d),
        oldVersion: old.version,
        newVersion: d.version,
      });
    }
  }
  return out;
}

export function formatRefreshChange(c: RefreshChange): string {
  if (c.kind === "added") {
    return `${c.role}:${c.displayName} (new) ${c.newVersion}`;
  }
  return `${c.role}:${c.displayName} ${c.oldVersion} -> ${c.newVersion}`;
}
