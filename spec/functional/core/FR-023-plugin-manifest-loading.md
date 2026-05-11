---
id: FR-023
title: Plugin Discovery
type: functional-requirement
status: superseded
related:
  - StR-008
  - US-012
  - FR-021
---
# FR-023 Plugin Discovery

> **Status: superseded.** The original FR-023 required loading enabled
> plugins from distribution defaults plus on-disk user and project plugin
> manifests. That requirement has been retired — see `spec/runtime-plugin-platform-plan.md`.

Plugin discovery SHALL use oclif's native plugin system. The set of active
plugins for a CLI binary is declared in the binary's `package.json`
`oclif.plugins` array, with `@oclif/plugin-plugins` available for
user-installable plugins.

## Acceptance Criteria

- FR-023-AC-1: A CLI binary's active plugin set is the union of
  `oclif.plugins` (built-in for the distribution) and any plugins the
  user has installed via `@oclif/plugin-plugins`.
- FR-023-AC-2: No on-disk plugin manifest (`plugins.yaml`) is loaded by
  the runtime.
- FR-023-AC-3: Per-project enable/disable of plugins is not supported.
  Users who want a different plugin set ship or install a different
  binary.
- FR-023-AC-4: Plugin load failures are surfaced by oclif's normal error
  path; the IX runtime does not add a separate isolation layer.

## Notes

The original FR-023 was motivated by per-project plugin enable/disable.
That feature was dropped as not actually required. With it gone, the
chicken-and-egg between config-root resolution and plugin discovery
dissolves (see FR-022 notes), so the manifest loader and merge logic are
no longer needed.
