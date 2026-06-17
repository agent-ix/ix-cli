---
id: FR-001
title: "packages/local — Migrated Command Set from ix-local-cli"
type: FR
relationships:
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-001"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-002"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-003"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-004"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-006"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-007"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-008"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-009"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-010"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-011"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-012"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-013"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-014"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-015"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-016"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-017"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-018"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-019"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-020"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-001"
    type: "implements"
    cardinality: "1:1"
---

## Description

`@agent-ix/ix-cli-local` implements the full command set originally defined in `ix-local-cli`. The behaviors specified in ix-local-cli FR-001 through [FR-020](../core/FR-020-core-plugin-schema.md) are preserved without modification in this package.

### Migrated Commands

| Command | ix-local-cli FR | Notes |
|---------|----------------|-------|
| `ix up <app\|svc>` | FR-001, [FR-008](./FR-008-ix-core-tag-convention.md), [FR-013](../elements/FR-013-elements-new.md) | Dispatch: image mode vs source mode |
| `ix down <app\|svc>` | [FR-002](./FR-002-phase-table-integration.md), [FR-003](./FR-003-concurrent-startup.md) | Service/app teardown |
| `ix init` | [FR-007](./FR-007-cluster-status.md) | Cluster initialization |
| `ix init admin` | FR-015 | Admin bootstrap seed |
| `ix auth reset-admin` | FR-016 | Reset admin password |
| `ix auth invite` | FR-017 | Invite user (creates new, or reissues fresh token for unclaimed) |
| `ix auth uninvite` | FR-017 | Revoke outstanding invite tokens for a pending user |
| `ix auth reset-user` | FR-018 | Reset user password |
| `ix auth config` | [FR-020](../core/FR-020-core-plugin-schema.md) | Email/social provider config |
| Service dir validation | [FR-004](./FR-004-cluster-subcommand-group.md) | Enforced on all service commands |
| Hostname scope | [FR-006](./FR-006-cluster-down.md) | `--hostname` flag or config |
| Registry discovery | [FR-012](../elements/FR-012-elements-tap.md) | Chart registry detection |
| Host-mount catalog | FR-014 | Named mount bindings |

## Constraints

- **FR-001-CON-1**: All command behavior defined in ix-local-cli FR-001 through [FR-020](../core/FR-020-core-plugin-schema.md) SHALL remain unchanged in this package except where superseded by [FR-002](./FR-002-phase-table-integration.md) (display) or [FR-003](./FR-003-concurrent-startup.md) (output routing).
- **FR-001-CON-2**: The package SHALL NOT import from ix-local-cli or vendor its source. All logic is co-located in `packages/local/src/`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-001-AC-1 | All commands listed in the migration table are registered under the `local` command tree. | Test |
| FR-001-AC-2 | Acceptance criteria from ix-local-cli FR-001 through [FR-020](../core/FR-020-core-plugin-schema.md) are satisfied by the implementation in this package. | Test |


- **FR-001-AC-1**: All commands listed in the migration table are registered under the `local` command tree.
- **FR-001-AC-2**: Acceptance criteria from ix-local-cli FR-001 through [FR-020](../core/FR-020-core-plugin-schema.md) are satisfied by the implementation in this package.

## Dependencies

- **migrated_from**: ix-local-cli/spec/functional/FR-001
- **migrated_from**: ix-local-cli/spec/functional/[FR-002](./FR-002-phase-table-integration.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-003](./FR-003-concurrent-startup.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-004](./FR-004-cluster-subcommand-group.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-006](./FR-006-cluster-down.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-007](./FR-007-cluster-status.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-008](./FR-008-ix-core-tag-convention.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-009](./FR-009-cluster-default-configuration.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-010](../elements/FR-010-elements-list.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-011](../elements/FR-011-elements-init.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-012](../elements/FR-012-elements-tap.md)
- **migrated_from**: ix-local-cli/spec/functional/[FR-013](../elements/FR-013-elements-new.md)
- **migrated_from**: ix-local-cli/spec/functional/FR-014
- **migrated_from**: ix-local-cli/spec/functional/FR-015
- **migrated_from**: ix-local-cli/spec/functional/FR-016
- **migrated_from**: ix-local-cli/spec/functional/FR-017
- **migrated_from**: ix-local-cli/spec/functional/FR-018
- **migrated_from**: ix-local-cli/spec/functional/FR-019
- **migrated_from**: ix-local-cli/spec/functional/[FR-020](../core/FR-020-core-plugin-schema.md)
- **implements**: ix-cli/spec/usecase/[US-001](../../usecase/US-001-deploy-app-to-local-cluster.md)
