---
id: FR-003
title: "Concurrent Service Startup with Rate-Control Pools"
type: FR
relationships:
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-021"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-002"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-001"
    type: "implements"
    cardinality: "1:1"
---

## Description

All behaviors defined in ix-local-cli FR-021 are preserved in this package without modification.

`ix up <app>` starts all child service install pipelines concurrently. Three shared pools rate-limit expensive I/O:

| Pool | Default | Controls |
|------|---------|---------|
| `docker_pull` | 3 | OCI chart fetches |
| `helm_install` | 5 | `helm upgrade --install` calls |
| `kubectl_watch` | 10 | `kubectl rollout status` watchers |

Pool sizes are read from `~/.ix/config.yaml` under the `concurrency:` key; defaults apply when the file or key is absent.

## Acceptance Criteria

All acceptance criteria from ix-local-cli FR-021-AC-1 through FR-021-AC-7 apply to this package unchanged.

- **FR-003-AC-1**: Services blocked on a pool slot signal `PhaseTable` with `queued` phase state (visible as `⏳` on TTY).
- **FR-003-AC-2**: A failure in one child service does not abort other concurrent pipelines; all run to completion before the command exits.
- **FR-003-AC-3**: Exit code 0 iff every child service succeeded; exit code 1 if any failed.
