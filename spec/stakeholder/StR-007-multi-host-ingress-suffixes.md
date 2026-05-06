---
id: StR-007
title: "Multi-Host Ingress Suffixes for Shared / Remote Clusters"
artifact_type: StR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-003"
    type: "extends"
    cardinality: "1:1"
---

## Stakeholder Need

A local cluster on a developer's laptop only needs one hostname suffix
(`*.dev.ix`). A cluster running on a named, network-reachable host (e.g.
`luna`, or an alpha/beta box destined for `agent-ix.dev`) legitimately
needs to answer to several suffixes at once:

- A **local-stable** suffix (`dev.ix`) so docs, scripts, and muscle memory
  keep working regardless of where the cluster is running.
- A **machine-stable** suffix (`luna.ix`) so other people on the network
  can address the cluster by its host identity.
- A **public** suffix (`agent-ix.dev`) once the cluster fronts a real
  audience.

Stakeholders need a per-cluster config that lists every suffix the
cluster should answer to, with the operator able to opt specific edge /
gateway services into the public-facing suffixes while keeping
backend services reachable only on the cluster-internal suffix (for
debugging, not external exposure).

## Priority

Must-Have
