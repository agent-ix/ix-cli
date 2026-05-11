import fs from "node:fs";
import path from "node:path";

import { configRoot } from "@agent-ix/ix-cli-core";
import { parse, stringify } from "yaml";

function configPath(): string {
  return path.join(configRoot(), "elements-taps.yaml");
}

export const ROOT_TAP = "github.com/agent-ix";

const VALID_TAP = /^github\.com\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?$/;

export function validateTapUrl(url: string): void {
  if (!VALID_TAP.test(url)) {
    throw new Error(
      `Invalid tap URL '${url}'. Expected 'github.com/<org>' or 'github.com/<org>/<repo>'.`,
    );
  }
}

export interface TapConfig {
  taps: string[];
}

export function loadTapConfig(): TapConfig {
  if (!fs.existsSync(configPath())) {
    return { taps: [ROOT_TAP] };
  }
  const raw = fs.readFileSync(configPath(), "utf8");
  const parsed = parse(raw) as Partial<TapConfig>;
  const taps = parsed.taps ?? [ROOT_TAP];
  if (!taps.includes(ROOT_TAP)) {
    taps.unshift(ROOT_TAP);
  }
  return { taps };
}

export function saveTapConfig(config: TapConfig): void {
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), stringify(config), "utf8");
}

export function addTap(url: string): boolean {
  validateTapUrl(url);
  const config = loadTapConfig();
  if (config.taps.includes(url)) return false;
  config.taps.push(url);
  saveTapConfig(config);
  return true;
}

export function removeTap(url: string): void {
  if (url === ROOT_TAP) {
    throw new Error(`Cannot remove the root tap '${ROOT_TAP}'.`);
  }
  const config = loadTapConfig();
  config.taps = config.taps.filter((t) => t !== url);
  saveTapConfig(config);
}
