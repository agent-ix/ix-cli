---
id: FR-008
title: "ix-core Tag Convention for Default Service Set"
artifact_type: FR
object: convention
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-004"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-005"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

Services published to the local app registry declare membership in the default cluster bring-up set by including the string `"ix-core"` in their `tags` array (as stored in the registry `Deployable` object).

The `ix-core` namespace prefix distinguishes platform-managed defaults from project-specific or user-defined tags. Future tags in this namespace (e.g. `ix-observability`) follow the same convention.

`computeEffectiveDeploySet` treats `ix-core` (or any tag listed in `ClusterConfig.defaultTags`) as an inclusion criterion. The tag value is compared by exact string equality.

## Acceptance

- **FR-008-AC-1**: A service with `tags: ["ix-core"]` is included in the default deploy set.
- **FR-008-AC-2**: A service without `ix-core` in its tags is excluded from the default deploy set unless listed in `extraApps`.
- **FR-008-AC-3**: Tag matching is case-sensitive exact-string equality.
- **FR-008-AC-4**: Multiple tags on a service — the service is included if any tag matches a `defaultTags` entry.
