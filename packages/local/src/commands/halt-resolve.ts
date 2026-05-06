/**
 * FR-035 — pure resolver for `ix local halt` releases.
 *
 * Extracted from `runDown` so the registry → (release, namespace) mapping is
 * directly unit-testable without mocking config/registry/execa together.
 */

import {
  IX_APPS_NAMESPACE,
  IX_AUTH_NAMESPACE,
  IX_PLATFORM_NAMESPACE,
  IX_SYSTEM_NAMESPACE,
  type IxConfig,
} from "../config.js";
import { resolveDeployableNamespace, type Deployable } from "../discovery.js";
import { findDeployable } from "../registry.js";

export interface ResolvedRelease {
  name: string;
  namespace: string;
}

/**
 * Image-mode app expansion seam — matches the shape returned by
 * `commands/up-image.ts:defaultExpandApp`. Injected here so tests don't have
 * to mock the full helm-pull pipeline that the real expander runs.
 */
export type ExpandApp = (
  deployable: Deployable,
  config: IxConfig,
) => Promise<Array<{ name: string; namespace: string }>>;

/**
 * Halt order: drain dependents before their dependencies. Apps depend on auth
 * and platform; auth depends on system. Sorting in this direction prevents
 * a half-completed run from leaving downstream pods CrashLoopBackOff'ing
 * against a removed dependency. (Helm's --ignore-not-found makes the run
 * itself idempotent, so this is about minimizing flap during the run.)
 */
const TIER_ORDER: Record<string, number> = {
  [IX_APPS_NAMESPACE]: 0,
  [IX_AUTH_NAMESPACE]: 1,
  [IX_PLATFORM_NAMESPACE]: 2,
  [IX_SYSTEM_NAMESPACE]: 3,
};

function tierIndex(namespace: string): number {
  return TIER_ORDER[namespace] ?? 99;
}

/**
 * Resolve the list of (release, namespace) pairs to uninstall for a given
 * `services` argument. `"all"` enumerates the entire registry; named
 * services resolve only those deployables. Mixing "all" with named services
 * is a caller error and must be rejected before this function is called.
 *
 * Releases are deduplicated by `${namespace}/${name}` and sorted by namespace
 * tier so dependents come before their dependencies during teardown.
 */
export async function resolveDownReleases(
  services: string[],
  registry: Deployable[],
  config: IxConfig,
  expandApp: ExpandApp,
): Promise<ResolvedRelease[]> {
  const releases: ResolvedRelease[] = [];
  const seen = new Set<string>();
  const pushRelease = (name: string, namespace: string): void => {
    const key = `${namespace}/${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    releases.push({ name, namespace });
  };

  const isAll = services.includes("all");
  const targets = isAll ? registry.map((d) => d.name) : services;
  for (const svc of targets) {
    const deployable = findDeployable(registry, svc);
    if (deployable.role === "app") {
      // FR-031: app-role deployables install as a single umbrella Helm
      // release named after the deployable. Uninstall that release first;
      // Helm cleans up all subchart resources as part of it.
      pushRelease(deployable.name, resolveDeployableNamespace(deployable));
      // Transitional cleanup: prior versions of ix-cli installed each
      // subchart as its own Helm release. Include those names too so
      // users mid-migration aren't left with orphan releases.
      const installs = await expandApp(deployable, config);
      for (const install of installs) {
        pushRelease(install.name, install.namespace);
      }
    } else {
      pushRelease(deployable.name, resolveDeployableNamespace(deployable));
    }
  }

  if (isAll) {
    // Sort dependents-before-dependencies for "all". Within a tier, preserve
    // insertion order so per-app umbrella → subchart ordering survives.
    return releases
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const ta = tierIndex(a.r.namespace);
        const tb = tierIndex(b.r.namespace);
        if (ta !== tb) return ta - tb;
        return a.i - b.i;
      })
      .map((x) => x.r);
  }
  return releases;
}
