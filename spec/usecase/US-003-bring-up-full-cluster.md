---
id: US-003
title: "Developer Brings Up the Full Local Cluster"
type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-004"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **developer**, I want to run `ix local cluster up` and have the kind cluster bootstrapped and all default services deployed in one step, so that I have a fully operational local Agent IX environment without manually running kind/helm commands.

## Context

`ix local cluster up` first runs `ix local init-cluster` to create the kind cluster (idempotent), then loads the app registry, computes the effective deploy set (ix-core tagged apps, plus extraApps, minus skipApps), and deploys each app using the image-mode pipeline.

## Acceptance

- **US-003-AC-1**: Running `ix local cluster up` creates the kind cluster if it does not exist.
- **US-003-AC-2**: All services tagged `ix-core` are deployed automatically.
- **US-003-AC-3**: Services in `extraApps` config are deployed in addition to the tag-filtered set.
- **US-003-AC-4**: Services in `skipApps` config are excluded even if tagged `ix-core`.
- **US-003-AC-5**: The command is idempotent — re-running it upgrades existing releases rather than failing.
