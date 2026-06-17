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

All behaviors defined in ix-local-cli [FR-021](../core/FR-021-ix-login.md) are preserved in this package without modification.

`ix up <app>` starts all child service install pipelines concurrently. Three shared pools rate-limit expensive I/O:

| Pool | Default | Controls |
|------|---------|---------|
| `docker_pull` | 3 | OCI chart fetches |
| `helm_install` | 5 | `helm upgrade --install` calls |
| `kubectl_watch` | 10 | `kubectl rollout status` watchers |

Pool sizes are read from `~/.ix/config.yaml` under the `concurrency:` key; defaults apply when the file or key is absent.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-003-AC-1 | Services blocked on a pool slot signal `PhaseTable` with `queued` phase state (visible as `⏳` on TTY). | Test |
| FR-003-AC-2 | A failure in one child service does not abort other concurrent pipelines; all run to completion before the command exits. | Test |
| FR-003-AC-3 | Exit code 0 iff every child service succeeded; exit code 1 if any failed. | Test |


All acceptance criteria from ix-local-cli [FR-021-AC-1](../core/FR-021-ix-login.md) through [FR-021-AC-7](../core/FR-021-ix-login.md) apply to this package unchanged.

- **FR-003-AC-1**: Services blocked on a pool slot signal `PhaseTable` with `queued` phase state (visible as `⏳` on TTY).
- **FR-003-AC-2**: A failure in one child service does not abort other concurrent pipelines; all run to completion before the command exits.
- **FR-003-AC-3**: Exit code 0 iff every child service succeeded; exit code 1 if any failed.

## Dependencies

- **migrated_from**: ix-local-cli/spec/functional/[FR-021](../core/FR-021-ix-login.md)
- **requires**: ix-cli/spec/functional/local/[FR-002](./FR-002-phase-table-integration.md)
- **implements**: ix-cli/spec/usecase/[US-001](../../usecase/US-001-deploy-app-to-local-cluster.md)
