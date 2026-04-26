import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ElementEntry } from "./resolver.js";

const CACHE_DIR = path.join(os.homedir(), ".cache", "ix", "elements");
const TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheFile {
  cachedAt: number;
  elements: ElementEntry[];
}

function tapSlug(tap: string): string {
  return tap.replace(/[^a-zA-Z0-9-]/g, "_");
}

function cachePath(tap: string): string {
  return path.join(CACHE_DIR, `${tapSlug(tap)}.json`);
}

export function readCache(tap: string): ElementEntry[] | null {
  const p = cachePath(tap);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as CacheFile;
    if (Date.now() - raw.cachedAt > TTL_MS) {
      fs.rmSync(p, { force: true });
      return null;
    }
    return raw.elements;
  } catch {
    return null;
  }
}

export function writeCache(tap: string, elements: ElementEntry[]): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const data: CacheFile = { cachedAt: Date.now(), elements };
  fs.writeFileSync(cachePath(tap), JSON.stringify(data, null, 2), "utf8");
}

export function invalidateCache(tap?: string): void {
  if (tap) {
    const p = cachePath(tap);
    if (fs.existsSync(p)) fs.rmSync(p);
    return;
  }
  if (fs.existsSync(CACHE_DIR)) {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      fs.rmSync(path.join(CACHE_DIR, f), { recursive: true, force: true });
    }
  }
}
