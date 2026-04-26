/**
 * FR-007 — Deployable discovery via OCI annotations.
 *
 * Enumerates GHCR container packages in an org, fetches each chart's
 * OCI manifest, and filters to those carrying `org.agent-ix.deployable`
 * annotation set to "app" or "service".
 *
 * No hardcoded chart catalog — registry is the source of truth.
 */

const HELM_CONFIG_MEDIA_TYPE = "application/vnd.cncf.helm.config.v1+json";
const OCI_MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";

export type DeployableRole = "app" | "service";

export interface Deployable {
  /** Chart name, e.g. "auth", "auth-service" */
  name: string;
  /** Full repo path under registry host, e.g. "agent-ix/auth" → oci://ghcr.io/agent-ix/auth/<name> */
  chartRepository: string;
  /** Latest discovered version */
  version: string;
  role: DeployableRole;
  title: string | null;
  category: string | null;
  tags: string[];
  source: string | null;
  /** FR-007-AC-4: org.agent-ix.entry — name of the primary user-facing dependency (app charts only) */
  entry: string | null;
}

export function parseDeployableTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

interface GhPackage {
  name: string;
}

interface GhPackageVersion {
  name: string; // sha256 digest
  metadata?: {
    container?: {
      tags?: string[];
    };
  };
}

interface OciManifest {
  schemaVersion: number;
  config: { mediaType: string };
  annotations?: Record<string, string>;
}

/**
 * Pluggable HTTP layer so tests can stub network calls.
 */
export interface DiscoveryHttp {
  fetchJson<T>(url: string, headers: Record<string, string>): Promise<T>;
}

const defaultHttp: DiscoveryHttp = {
  async fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return (await res.json()) as T;
  },
};

export interface DiscoverOptions {
  org: string;
  /** GitHub PAT with read:packages */
  githubToken: string;
  http?: DiscoveryHttp;
  /** Cap on packages probed in parallel for manifest fetch */
  concurrency?: number;
}

/**
 * Pick the highest SemVer-looking tag. Falls back to the first tag if
 * none match. Returns null if no tags.
 */
export function pickLatestTag(tags: string[]): string | null {
  if (tags.length === 0) return null;
  const semver = tags
    .map((t) => {
      const m = t.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
      if (!m) return null;
      return {
        tag: t,
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        pre: m[4] ?? "",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (semver.length === 0) return tags[0];
  semver.sort((a, b) => {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    if (a.patch !== b.patch) return b.patch - a.patch;
    // Stable releases beat prereleases of the same M.m.p
    if (a.pre === "" && b.pre !== "") return -1;
    if (a.pre !== "" && b.pre === "") return 1;
    return a.pre < b.pre ? 1 : a.pre > b.pre ? -1 : 0;
  });
  return semver[0].tag;
}

async function listOrgPackages(
  http: DiscoveryHttp,
  org: string,
  token: string,
): Promise<GhPackage[]> {
  const all: GhPackage[] = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/orgs/${org}/packages?package_type=container&per_page=100&page=${page}`;
    const batch = await http.fetchJson<GhPackage[]>(url, {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function getLatestTag(
  http: DiscoveryHttp,
  org: string,
  pkg: string,
  token: string,
): Promise<string | null> {
  const encoded = encodeURIComponent(pkg);
  const url = `https://api.github.com/orgs/${org}/packages/container/${encoded}/versions?per_page=100`;
  const versions = await http.fetchJson<GhPackageVersion[]>(url, {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  });
  const tags = versions.flatMap((v) => v.metadata?.container?.tags ?? []);
  return pickLatestTag(tags);
}

async function fetchRegistryToken(
  http: DiscoveryHttp,
  org: string,
  pkg: string,
  ghToken: string,
): Promise<string> {
  const url = `https://ghcr.io/token?service=ghcr.io&scope=repository:${org}/${pkg}:pull`;
  const body = await http.fetchJson<{ token: string }>(url, {
    // GHCR's token endpoint accepts the GitHub PAT as Basic auth password.
    Authorization: `Basic ${Buffer.from(`x:${ghToken}`).toString("base64")}`,
  });
  return body.token;
}

async function fetchManifest(
  http: DiscoveryHttp,
  org: string,
  pkg: string,
  tag: string,
  ghToken: string,
): Promise<OciManifest> {
  const regToken = await fetchRegistryToken(http, org, pkg, ghToken);
  const url = `https://ghcr.io/v2/${org}/${pkg}/manifests/${tag}`;
  return http.fetchJson<OciManifest>(url, {
    Authorization: `Bearer ${regToken}`,
    Accept: OCI_MANIFEST_MEDIA_TYPE,
  });
}

function manifestToDeployable(
  org: string,
  pkgName: string,
  version: string,
  manifest: OciManifest,
): Deployable | null {
  if (manifest.config?.mediaType !== HELM_CONFIG_MEDIA_TYPE) return null;
  const ann = manifest.annotations ?? {};
  const role = ann["org.agent-ix.deployable"];
  if (role !== "app" && role !== "service") return null;

  // pkgName is e.g. "auth/auth" or "helm-charts/ix-service".
  // chartName is the last segment; chartRepository is the full registry
  // path under the host, including org and intermediate segments.
  const segments = pkgName.split("/");
  const chartName = segments[segments.length - 1];
  const chartRepository = [org, ...segments.slice(0, -1)].join("/");
  return {
    name: chartName,
    chartRepository,
    version,
    role,
    title: ann["org.agent-ix.title"] ?? null,
    category: ann["org.agent-ix.category"] ?? null,
    tags: parseDeployableTags(ann["org.agent-ix.tags"]),
    source: ann["org.opencontainers.image.source"] ?? null,
    entry: role === "app" ? (ann["org.agent-ix.entry"] ?? null) : null,
  };
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function discoverDeployables(
  opts: DiscoverOptions,
): Promise<Deployable[]> {
  const http = opts.http ?? defaultHttp;
  const concurrency = opts.concurrency ?? 6;

  const packages = await listOrgPackages(http, opts.org, opts.githubToken);

  // Helm charts publish under nested paths (oci://ghcr.io/<org>/<repo>/<chart>),
  // so candidate package names always contain a slash. Single-segment names
  // are docker images and not worth probing.
  const candidates = packages.filter((p) => p.name.includes("/"));

  const probed = await mapWithLimit(candidates, concurrency, async (pkg) => {
    try {
      const tag = await getLatestTag(
        http,
        opts.org,
        pkg.name,
        opts.githubToken,
      );
      if (!tag) return null;
      const manifest = await fetchManifest(
        http,
        opts.org,
        pkg.name,
        tag,
        opts.githubToken,
      );
      return manifestToDeployable(opts.org, pkg.name, tag, manifest);
    } catch {
      // A single bad package shouldn't blow up discovery.
      return null;
    }
  });

  return probed.filter((d): d is Deployable => d !== null);
}
