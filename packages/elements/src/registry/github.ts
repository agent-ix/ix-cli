import { readCredentials } from "@agent-ix/ix-cli-core";

export interface RepoEntry {
  name: string;
  description: string;
  url: string;
}

const ENV_VARS = [
  "IX_GITHUB_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "IX_GHCR_TOKEN",
  "CR_PAT",
] as const;

export function getGhToken(): string | undefined {
  for (const key of ENV_VARS) {
    const val = process.env[key]?.trim();
    if (val) return val;
  }
  return readCredentials().githubToken ?? undefined;
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function searchByTopic(
  org: string,
  token?: string,
): Promise<RepoEntry[]> {
  const url = `https://api.github.com/search/repositories?q=topic:ix-element+org:${org}&per_page=100`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    throw new Error(
      `GitHub topic search failed for org '${org}': ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as {
    items?: { name: string; description: string | null; html_url: string }[];
  };
  return (data.items ?? []).map((item) => ({
    name: item.name,
    description: item.description ?? "",
    url: item.html_url,
  }));
}
