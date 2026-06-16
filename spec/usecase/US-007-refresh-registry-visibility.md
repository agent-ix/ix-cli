---
id: US-007
title: "Developer Sees Which Charts Changed on Registry Refresh"
type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **developer**, I want `ix local refresh` to show me which charts moved
versions in the registry, so that I can tell at a glance whether a teammate
published something I need without diffing the cache file by hand.

## Context

`ix local refresh` re-discovers the org's deployable charts on GHCR and
rewrites `~/.cache/ix-local/registry.json`. Today the command prints only
`Refreshed registry: N deployable(s).` — useful as a heartbeat, useless for
spotting actual change. The fix is to compare the prior cache against the
freshly discovered set and surface per-chart movement using the same body
glyph (`GLYPH_DONE`) used elsewhere in the CLI's listing/phase-table output.

## Acceptance

- **US-007-AC-1**: Each chart whose version changed between the prior cache
  and the fresh registry is listed on its own row showing role, display
  name, old version, and new version.
- **US-007-AC-2**: Charts that did not exist in the prior cache are listed
  on their own row marked as new with the discovered version.
- **US-007-AC-3**: Charts that existed in the prior cache but no longer
  appear in the fresh registry are not listed (out of scope for this
  command).
- **US-007-AC-4**: When zero charts changed and zero were added, no per-chart
  rows are printed; only a single success line is shown.
