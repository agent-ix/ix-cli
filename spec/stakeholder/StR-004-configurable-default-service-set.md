---
id: StR-004
title: "Configurable Default Service Set for Cluster Bring-Up"
artifact_type: StR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-003"
    type: "extends"
    cardinality: "1:1"
---

## Stakeholder Need

Different teams and projects need different default services deployed to their local clusters. A platform engineer running observability tooling should not be required to deploy it by default on every developer's machine; conversely, core services like `ix-local-build` and `ix-local-data` should always be present.

**Stakeholders** need a convention-based mechanism to mark services as part of the default set, plus a per-user config to extend or restrict that set without changing shared repository configuration.

## Priority

Must-Have

## Acceptance

- **StR-004-AC-1**: Services tagged `ix-core` in their OCI manifest are included in the default cluster bring-up.
- **StR-004-AC-2**: Operators can add non-tagged services to the default set via `extraApps` in `~/.ix/config.yaml`.
- **StR-004-AC-3**: Operators can exclude tagged services from the default set via `skipApps` in `~/.ix/config.yaml`.
- **StR-004-AC-4**: When `~/.ix/config.yaml` is absent, sensible defaults apply (`ix-core` tag only, no extras or skips).
