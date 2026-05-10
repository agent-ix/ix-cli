/**
 * FR-014 — Host Mount Catalog & Install-Time Injection
 *
 * Owns the canonical catalog of host-backed volume sources (workspace root,
 * gcp creds dir, docker socket). Every Helm install performed by ix-local
 * sets `global.hostMounts.<name>.*` for each catalog entry so the ix-service
 * base chart can render the matching volumes, volumeMounts, and env.
 *
 * No user-specific path (e.g. /home/peter/dev) lives outside this module.
 */

import os from "node:os";
import path from "node:path";

export type HostMountType = "hostPath" | "pvc" | "csi" | "emptyDir";

export interface HostPathSource {
  type: "hostPath";
  /** Function so that $HOME is evaluated lazily per-run, not at import time. */
  path: () => string;
  hostPathType?: string;
  /**
   * When true, the resolved `containerPath` equals the host path. Required
   * for mounts whose paths must match across the host/container boundary —
   * e.g. a workspace referenced by a docker-in-docker build where the inner
   * `docker build <path>` must resolve on the outer daemon.
   */
  matchHostPath?: boolean;
}

export interface PvcSource {
  type: "pvc";
  claimName: string;
  readOnly?: boolean;
}

export interface CsiSource {
  type: "csi";
  driver: string;
  volumeHandle?: string;
  volumeAttributes?: Record<string, string>;
  readOnly?: boolean;
}

export interface EmptyDirSource {
  type: "emptyDir";
  medium?: "" | "Memory";
  sizeLimit?: string;
}

export type HostMountSource =
  | HostPathSource
  | PvcSource
  | CsiSource
  | EmptyDirSource;

export type Profile = "local" | "demo" | "alpha" | "beta" | "prod";

export interface HostMountCatalogEntry {
  /** Logical name used by consumer charts (e.g. `workspace`). */
  name: string;
  /** Canonical in-container mount path. Platform-owned. */
  containerPath: string;
  /** Optional env var set to containerPath on the primary container. */
  envVar?: string;
  /** readOnly flag applied to the volumeMount (independent of source.readOnly). */
  readOnly?: boolean;
  /** Per-profile volume sources. */
  sources: Partial<Record<Profile, HostMountSource>>;
  /** Optional env var that overrides the local-profile hostPath. */
  localEnvOverride?: string;
}

export interface ResolvedHostPathSource {
  type: "hostPath";
  path: string;
  hostPathType?: string;
}

export type ResolvedHostMountSource =
  | ResolvedHostPathSource
  | PvcSource
  | CsiSource
  | EmptyDirSource;

export interface ResolvedHostMount {
  name: string;
  containerPath: string;
  envVar?: string;
  readOnly?: boolean;
  source: ResolvedHostMountSource;
}

/**
 * The canonical catalog. Adding a new mount = adding an entry here.
 * Services opt in per-chart via `ix-service.hostMounts: [<name>, ...]`.
 */
export const HOST_MOUNT_CATALOG: HostMountCatalogEntry[] = [
  {
    name: "workspace",
    // Placeholder — overridden by matchHostPath on the local source below so
    // docker-in-docker path references resolve on both sides.
    containerPath: "/workspace",
    envVar: "WORKSPACE_ROOT",
    localEnvOverride: "IX_WORKSPACE_ROOT",
    sources: {
      local: {
        type: "hostPath",
        path: () => path.join(os.homedir(), "dev"),
        matchHostPath: true,
      },
    },
  },
  {
    name: "gcpCreds",
    containerPath: "/var/ix/gcp",
    readOnly: true,
    localEnvOverride: "IX_GCP_CREDS_DIR",
    sources: {
      local: { type: "hostPath", path: () => path.join(os.homedir(), ".gcp") },
    },
  },
  {
    name: "dockerSock",
    containerPath: "/var/run/docker-host/docker.sock",
    localEnvOverride: "IX_DOCKER_SOCK",
    sources: {
      local: { type: "hostPath", path: () => "/var/run/docker.sock" },
    },
  },
  {
    name: "vaultKeys",
    containerPath: "/var/ix/vault-keys",
    localEnvOverride: "IX_VAULT_KEYS_DIR",
    sources: {
      local: {
        type: "hostPath",
        path: () => path.join(os.homedir(), ".ix", "vault-keys"),
        hostPathType: "DirectoryOrCreate",
      },
    },
  },
  {
    name: "paperclipData",
    containerPath: "/paperclip",
    localEnvOverride: "IX_PAPERCLIP_DATA_DIR",
    sources: {
      local: {
        type: "hostPath",
        path: () => path.join(os.homedir(), ".ix", "paperclip", "data"),
        hostPathType: "DirectoryOrCreate",
      },
    },
  },
  {
    name: "paperclipDb",
    containerPath: "/var/lib/postgresql/data",
    localEnvOverride: "IX_PAPERCLIP_DB_DIR",
    sources: {
      local: {
        type: "hostPath",
        path: () => path.join(os.homedir(), ".ix", "paperclip", "db"),
        hostPathType: "DirectoryOrCreate",
      },
    },
  },
  {
    // Vault content for the AGE knowledge base. Bind-mounted at /vault by
    // the mcp-fs service in agent-ix/ix-age-vault. The host directory is
    // typically a clone of github.com/kreneskyp/age-vault — agent edits
    // land in the host repo so they can be `git add`-ed normally.
    name: "ageVault",
    containerPath: "/vault",
    localEnvOverride: "IX_AGE_VAULT_DATA_DIR",
    sources: {
      local: {
        type: "hostPath",
        path: () => path.join(os.homedir(), ".ix", "age-vault", "data"),
        hostPathType: "DirectoryOrCreate",
      },
    },
  },
];

/** Read the active profile from env. Defaults to `local`. */
export function resolveProfile(env: NodeJS.ProcessEnv = process.env): Profile {
  const raw = (env.IX_PROFILE ?? "local").toLowerCase();
  if (
    raw === "local" ||
    raw === "demo" ||
    raw === "alpha" ||
    raw === "beta" ||
    raw === "prod"
  ) {
    return raw;
  }
  throw new Error(
    `IX_PROFILE=${JSON.stringify(raw)} is not a valid profile (local|demo|alpha|beta|prod)`,
  );
}

/**
 * Resolve every catalog entry that has a source for the active profile.
 * Entries with no source for the profile are omitted — consumers that
 * declare such a mount will fail at helm-template time with a clear error
 * (see helm-charts FR-008).
 */
export function resolveCatalog(
  catalog: HostMountCatalogEntry[] = HOST_MOUNT_CATALOG,
  env: NodeJS.ProcessEnv = process.env,
  profile: Profile = resolveProfile(env),
): ResolvedHostMount[] {
  const resolved: ResolvedHostMount[] = [];
  for (const entry of catalog) {
    const src = entry.sources[profile];
    if (!src) continue;

    let concrete: ResolvedHostMountSource;
    let containerPath = entry.containerPath;
    if (src.type === "hostPath") {
      const override =
        profile === "local" && entry.localEnvOverride
          ? env[entry.localEnvOverride]?.trim()
          : undefined;
      const resolvedPath =
        override && override.length > 0 ? override : src.path();
      concrete = {
        type: "hostPath",
        path: resolvedPath,
        ...(src.hostPathType ? { hostPathType: src.hostPathType } : {}),
      };
      if (src.matchHostPath) containerPath = resolvedPath;
    } else {
      // Non-hostPath sources are platform-supplied and not env-overridable.
      concrete = { ...src };
    }

    resolved.push({
      name: entry.name,
      containerPath,
      ...(entry.envVar ? { envVar: entry.envVar } : {}),
      ...(entry.readOnly !== undefined ? { readOnly: entry.readOnly } : {}),
      source: concrete,
    });
  }
  return resolved;
}

/**
 * Flatten a resolved catalog into helm `--set-string` argv pairs.
 * Every entry is injected on every install; the chart renders only those
 * the consumer declares via `ix-service.hostMounts`.
 */
export function buildHelmSetArgs(mounts: ResolvedHostMount[]): string[] {
  const args: string[] = [];
  for (const m of mounts) {
    const prefix = `global.hostMounts.${m.name}`;
    const src = m.source;
    args.push("--set-string", `${prefix}.type=${src.type}`);
    args.push("--set-string", `${prefix}.containerPath=${m.containerPath}`);
    if (m.envVar) {
      args.push("--set-string", `${prefix}.envVar=${m.envVar}`);
    }
    if (m.readOnly) {
      args.push("--set-string", `${prefix}.readOnly=true`);
    }

    if (src.type === "hostPath") {
      args.push("--set-string", `${prefix}.hostPath=${src.path}`);
      if (src.hostPathType) {
        args.push("--set-string", `${prefix}.hostPathType=${src.hostPathType}`);
      }
    } else if (src.type === "pvc") {
      args.push("--set-string", `${prefix}.claimName=${src.claimName}`);
    } else if (src.type === "csi") {
      args.push("--set-string", `${prefix}.driver=${src.driver}`);
      if (src.volumeHandle) {
        args.push("--set-string", `${prefix}.volumeHandle=${src.volumeHandle}`);
      }
      if (src.volumeAttributes) {
        for (const [k, v] of Object.entries(src.volumeAttributes)) {
          args.push("--set-string", `${prefix}.volumeAttributes.${k}=${v}`);
        }
      }
    } else if (src.type === "emptyDir") {
      if (src.medium) {
        args.push("--set-string", `${prefix}.medium=${src.medium}`);
      }
      if (src.sizeLimit) {
        args.push("--set-string", `${prefix}.sizeLimit=${src.sizeLimit}`);
      }
    }
  }
  return args;
}
