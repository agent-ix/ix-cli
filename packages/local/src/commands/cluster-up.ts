/**
 * FR-005 — cluster up
 * Bootstrap kind cluster (FR-007) then deploy the effective ix-core app set (FR-009).
 */

import type { IxConfig, ClusterConfig } from "../config.js";
import type { Deployable } from "../discovery.js";
import { runInitCluster } from "./init-cluster.js";
import { runImageModeUp } from "./up-image.js";
import { loadRegistry, findDeployable } from "../registry.js";
import { resolveGhcrToken } from "../credentials.js";

/**
 * FR-009: compute effective deploy set from registry + cluster config.
 * tag-filtered ∪ extraApps − skipApps, deduplicated by name.
 */
export function computeEffectiveDeploySet(
  registry: Deployable[],
  clusterConfig: ClusterConfig,
  overrideTags?: string[],
): Deployable[] {
  const activeTags = overrideTags ?? clusterConfig.defaultTags;

  const tagMatched = registry.filter(
    (d) => d.role === "app" && activeTags.every((t) => d.tags.includes(t)),
  );

  const extras = clusterConfig.extraApps.map((name) => {
    try {
      return findDeployable(registry, name);
    } catch {
      throw new Error(
        `cluster.extraApps references unknown deployable: '${name}'. Run 'ix local list' to see available apps.`,
      );
    }
  });

  const seen = new Set<string>();
  const merged: Deployable[] = [];
  for (const d of [...tagMatched, ...extras]) {
    if (!seen.has(d.name)) {
      seen.add(d.name);
      merged.push(d);
    }
  }

  return merged.filter((d) => !clusterConfig.skipApps.includes(d.name));
}

export async function runClusterUp(
  config: IxConfig,
  clusterConfig: ClusterConfig,
  opts: {
    reconfigureCredentials?: boolean;
    includeTags?: string[];
    excludeTags?: string[];
  } = {},
): Promise<void> {
  // Phase 1: cluster bootstrap (framed by runTaskList inside runInitCluster)
  await runInitCluster(config, opts.reconfigureCredentials ?? false);

  // Phase 2: discover + deploy effective service set
  const token = config.ghcrToken?.trim() || (await resolveGhcrToken(false));
  const registry = await loadRegistry({
    org: config.org,
    githubToken: token,
  });

  const overrideTags =
    opts.includeTags && opts.includeTags.length > 0
      ? opts.includeTags
      : undefined;

  let deploySet = computeEffectiveDeploySet(
    registry,
    clusterConfig,
    overrideTags,
  );

  if (opts.excludeTags && opts.excludeTags.length > 0) {
    deploySet = deploySet.filter(
      (d) => !opts.excludeTags!.some((t) => d.tags.includes(t)),
    );
  }

  if (deploySet.length === 0) {
    return;
  }

  process.stdout.write("\n");

  // Each runImageModeUp call frames its own display (PhaseTable or Listr).
  for (let i = 0; i < deploySet.length; i++) {
    if (i > 0) process.stdout.write("\n");
    await runImageModeUp(deploySet[i], config, null, undefined, {}, undefined);
  }
}
