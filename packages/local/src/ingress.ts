import { execa } from "execa";
import { parseAllDocuments } from "yaml";

interface IngressDoc {
  apiVersion?: string;
  kind?: string;
  spec?: {
    tls?: Array<{ hosts?: unknown }>;
    rules?: Array<{ host?: unknown }>;
  };
}

function isIngressDoc(doc: unknown): doc is IngressDoc {
  const d = doc as IngressDoc | null;
  return d?.kind === "Ingress" && d.apiVersion === "networking.k8s.io/v1";
}

function stringList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string")
    : [];
}

export function ingressUrlsFromManifest(manifest: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const document of parseAllDocuments(manifest)) {
    const parsed = document.toJSON();
    if (!isIngressDoc(parsed)) continue;

    const tlsHosts = new Set(
      (parsed.spec?.tls ?? []).flatMap((tls) => stringList(tls.hosts)),
    );
    for (const rule of parsed.spec?.rules ?? []) {
      if (typeof rule.host !== "string" || rule.host.trim() === "") continue;
      const host = rule.host.trim();
      const scheme = tlsHosts.has(host) ? "https" : "http";
      const url = `${scheme}://${host}`;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

export async function getReleaseIngressUrls(
  releaseName: string,
  namespace: string,
): Promise<string[]> {
  const { stdout } = await execa(
    "helm",
    ["get", "manifest", releaseName, "-n", namespace],
    { all: true },
  );
  return ingressUrlsFromManifest(stdout);
}
