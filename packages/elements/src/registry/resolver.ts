import { readCache, writeCache } from "./cache.js";
import { getGhToken, searchByTopic } from "./github.js";
import { loadTapConfig } from "../tap-config.js";

export interface ElementEntry {
  type: string;
  name: string;
  description: string;
  repoUrl: string;
  tap: string;
}

function parseGithubTap(tap: string): { owner: string } | null {
  const match = tap.match(/^github\.com\/([^/]+)$/);
  if (!match) return null;
  return { owner: match[1] };
}

function parseGithubRepoTap(
  tap: string,
): { owner: string; repo: string } | null {
  const match = tap.match(/^github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function repoNameToType(name: string): string {
  return name.replace(/-cookiecutter$/, "");
}

async function fetchElementsForTap(
  tap: string,
  token?: string,
): Promise<ElementEntry[]> {
  const orgTap = parseGithubTap(tap);
  if (orgTap) {
    const repos = await searchByTopic(orgTap.owner, token);
    return repos.map((repo) => ({
      type: repoNameToType(repo.name),
      name: repo.name,
      description: repo.description,
      repoUrl: repo.url,
      tap,
    }));
  }

  const repoTap = parseGithubRepoTap(tap);
  if (repoTap) {
    return [
      {
        type: repoNameToType(repoTap.repo),
        name: repoTap.repo,
        description: "",
        repoUrl: `https://github.com/${repoTap.owner}/${repoTap.repo}`,
        tap,
      },
    ];
  }

  throw new Error(
    `Unrecognised tap format '${tap}'. Expected 'github.com/<org>' or 'github.com/<org>/<repo>'.`,
  );
}

export async function resolveAllElements(
  opts: { refresh?: boolean } = {},
): Promise<ElementEntry[]> {
  const { taps } = loadTapConfig();
  const token = getGhToken();
  const all: ElementEntry[] = [];

  for (const tap of taps) {
    if (!opts.refresh) {
      const cached = readCache(tap);
      if (cached) {
        all.push(...cached);
        continue;
      }
    }
    const elements = await fetchElementsForTap(tap, token);
    writeCache(tap, elements);
    all.push(...elements);
  }

  return all;
}

export async function resolveElementByType(
  type: string,
  opts: { refresh?: boolean } = {},
): Promise<ElementEntry> {
  const all = await resolveAllElements(opts);
  const match = all.find((e) => e.type === type);
  if (!match) {
    throw new Error(
      `Unknown element type '${type}'. Run 'ix elements list' to see available types.`,
    );
  }
  return match;
}
