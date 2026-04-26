/**
 * FR-007 — Cached registry of discovered deployables.
 *
 * Wraps `discoverDeployables` with a JSON cache at
 * `~/.cache/ix-local/registry.json`. TTL defaults to 1h; callers can
 * force refresh.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverDeployables, type Deployable } from "./discovery.js";

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheFile {
  org: string;
  fetchedAt: number;
  deployables: Deployable[];
}

function cachePath(): string {
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(base, "ix-local", "registry.json");
}

function readCache(): CacheFile | null {
  const file = cachePath();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as CacheFile;
  } catch {
    return null;
  }
}

function writeCache(data: CacheFile): void {
  const file = cachePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // FR-012-AC-6: mode 0600 — cache contains org metadata; restrict to user.
  fs.writeFileSync(file, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export interface LoadRegistryOptions {
  org: string;
  githubToken: string;
  /** Skip cache and re-discover */
  refresh?: boolean;
  ttlMs?: number;
  /** Override discovery (test seam). */
  discover?: (args: {
    org: string;
    githubToken: string;
  }) => Promise<Deployable[]>;
}

export async function loadRegistry(
  opts: LoadRegistryOptions,
): Promise<Deployable[]> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  if (!opts.refresh) {
    const cached = readCache();
    if (
      cached &&
      cached.org === opts.org &&
      Date.now() - cached.fetchedAt < ttl
    ) {
      return cached.deployables;
    }
  }
  const discover = opts.discover ?? discoverDeployables;
  const deployables = await discover({
    org: opts.org,
    githubToken: opts.githubToken,
  });
  writeCache({ org: opts.org, fetchedAt: Date.now(), deployables });
  return deployables;
}

export class DeployableNotFoundError extends Error {
  constructor(name: string, known: string[]) {
    super(
      `No deployable named '${name}' in registry. Known: ${known.sort().join(", ")}`,
    );
    this.name = "DeployableNotFoundError";
  }
}

export function findDeployable(
  registry: Deployable[],
  name: string,
): Deployable {
  const hit = registry.find((d) => d.name === name);
  if (!hit) {
    throw new DeployableNotFoundError(
      name,
      registry.map((d) => d.name),
    );
  }
  return hit;
}
