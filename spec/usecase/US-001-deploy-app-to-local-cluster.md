---
id: US-001
title: "Developer Deploys an App to the Local Cluster"
type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/usecase/US-005"
    type: "migrated_from"
    cardinality: "1:1"
---

## Story

As a **developer**, I want to run `ix up <app>` and have all of the app's services deployed to my local cluster concurrently, so that I can start developing against a fully running environment without waiting for sequential deploys.

## Context

`ix up <app>` expands an app manifest into its constituent services, then runs each service through a four-phase pipeline: pull → secrets → install → ready. The umbrella chart is pulled first so secret contracts can be extracted from the published subchart tgzs before any kubectl or helm install runs. Services run concurrently, rate-limited by shared pools to avoid registry throttling.

## Acceptance

- **US-001-AC-1**: Running `ix up <app>` deploys all child services concurrently to the local cluster.
- **US-001-AC-2**: A phase-column table shows live progress per service during the deploy.
- **US-001-AC-3**: On success, a frozen summary shows per-service elapsed time and an app URL when available.
- **US-001-AC-4**: On failure, the frozen summary identifies which services failed with their error.
- **US-001-AC-5**: On non-TTY (CI), one structured line per phase transition is emitted with no ANSI codes.
