---
id: US-009
title: "Developer Pauses the Local Cluster Without Losing State"
artifact_type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **developer**, I want to run `ix local cluster stop` to pause the local cluster at the end of the day and `ix local cluster start` to resume the next morning, so that I can free CPU/memory without rebuilding the cluster from scratch and without losing PVC data.

## Context

`kind` does not natively support pause; the cluster runs as one or more Docker containers. `ix local cluster stop` discovers the kind container nodes and runs `docker stop` on each, freeing host CPU/memory while preserving all volumes and configuration. `ix local cluster start` reverses this with `docker start` and waits for the API server to respond before returning. Both commands are idempotent: stopping an already-stopped cluster (or starting an already-running one) reports the state and exits cleanly. If no kind cluster exists at all, both commands fail with a clear message rather than silently creating one.

## Acceptance

- **US-009-AC-1**: Running `ix local cluster stop` shuts down the kind cluster's containers and reports each node's new state.
- **US-009-AC-2**: Running `ix local cluster start` brings the cluster back online and does not return until the API server is reachable.
- **US-009-AC-3**: Stop → start round trip preserves PVC data, Helm release state, and ingress configuration.
- **US-009-AC-4**: Both commands are idempotent — repeating stop or start does not error.
- **US-009-AC-5**: If no kind cluster exists, both commands exit non-zero with a message directing the user to `ix local init` or `ix local cluster up`.
