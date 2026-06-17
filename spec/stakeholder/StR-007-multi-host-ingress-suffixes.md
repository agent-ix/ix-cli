---
id: StR-007
title: "Multi-Host Ingress Suffixes for Shared / Remote Clusters"
type: StR
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

## Rationale

A laptop cluster needs only one suffix, but a cluster running on a named or
network-reachable host must answer to several at once — a local-stable suffix so
existing docs and muscle memory keep working, a machine-stable suffix so others
can address it by host identity, and a public suffix once it fronts a real
audience — without forcing edge and backend services to share the same exposure.
A per-cluster list of suffixes, with selective opt-in of edge services to the
public suffixes, is therefore required.

## Priority

Must-Have

## Validation Criteria

This need is satisfied when an operator can configure a per-cluster list of host
suffixes that the cluster answers to simultaneously; when the local-stable
suffix continues to resolve regardless of where the cluster runs; and when edge
or gateway services can be opted into the public-facing suffixes while backend
services remain reachable only on the cluster-internal suffix. Satisfaction is
judged by deploying a cluster with multiple configured suffixes and demonstrating
each of these outcomes.
