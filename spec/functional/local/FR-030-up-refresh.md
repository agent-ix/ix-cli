---
id: FR-030
title: "ix up --refresh — Force Helm Dependency Re-Resolution"
artifact_type: FR
object: process
relationships:
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-008"
    type: "extends"
    cardinality: "1:1"
---

## Behavior

`ix local up --refresh` forces `helm dependency update` for every source-mode
install in the run, re-pulling subchart `.tgz` artifacts from the OCI registry
even when a vendored copy already sits in the chart's `charts/` directory.

Without the flag, `runSourceModeUp` uses `shouldDependencyUpdate(chartPath)` to
decide per-install whether to add `--dependency-update` to the helm command;
when every declared dependency is already vendored locally (as `charts/<name>/`
or `charts/<name>-<version>.tgz`), the call is skipped to avoid an OCI round
trip.

`--refresh` overrides that heuristic so the install always sees the freshest
published patch versions of its OCI subchart deps. The flag is **opt-in** —
default behavior is unchanged so repeated `ix up` invocations remain
deterministic from teammate to teammate.

The flag is **helm-only**: it does not affect container images, the OCI image
layer cache, or the `helm pull` cache used by image-mode (`up-image.ts`)
installs. To re-pull chart artifacts in image mode, omit `--tag` and rely on the
umbrella `Chart.yaml`'s pinned subchart versions, or use `ix local refresh`
(separate command) to invalidate the registry cache.

## Acceptance

- **FR-030-AC-1**: `--refresh` is declared on `apps/ix/src/commands/local/up.ts`
  as `Flags.boolean({ description: ... })` and reaches `runUp` via the parsed
  options object.
- **FR-030-AC-2**: `runUp` propagates `refresh` into the `UpFilterOptions`
  passed to `runSourceModeUp`.
- **FR-030-AC-3**: When `opts.refresh === true`, every `LocalInstall` produced
  by `runSourceModeUp` has `dependencyUpdate === true`, regardless of what
  `shouldDependencyUpdate(chartPath)` returned during resolution.
- **FR-030-AC-4**: When `opts.refresh` is unset or false, install
  `dependencyUpdate` values are unchanged from `shouldDependencyUpdate`.
- **FR-030-AC-5**: The flag is documented in the `--help` output of
  `ix local up`.
- **FR-030-AC-6**: `--refresh` does not change image-mode behavior — no edits
  to `up-image.ts` are required to satisfy this FR.
