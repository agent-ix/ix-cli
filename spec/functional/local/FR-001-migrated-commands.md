---
id: FR-001
title: "packages/local — Migrated Command Set from ix-local-cli"
artifact_type: FR
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

`@agent-ix/ix-cli-local` implements the full command set originally defined in `ix-local-cli`. The behaviors specified in ix-local-cli FR-001 through FR-020 are preserved without modification in this package.

### Migrated Commands

| Command | ix-local-cli FR | Notes |
|---------|----------------|-------|
| `ix up <app\|svc>` | FR-001, FR-008, FR-013 | Dispatch: image mode vs source mode |
| `ix down <app\|svc>` | FR-002, FR-003 | Service/app teardown |
| `ix init` | FR-007 | Cluster initialization |
| `ix init admin` | FR-015 | Admin bootstrap seed |
| `ix auth reset-admin` | FR-016 | Reset admin password |
| `ix auth invite` | FR-017 | Invite user (creates new, or reissues fresh token for unclaimed) |
| `ix auth uninvite` | FR-017 | Revoke outstanding invite tokens for a pending user |
| `ix auth reset-user` | FR-018 | Reset user password |
| `ix auth config` | FR-020 | Email/social provider config |
| Service dir validation | FR-004 | Enforced on all service commands |
| Hostname scope | FR-006 | `--hostname` flag or config |
| Registry discovery | FR-012 | Chart registry detection |
| Host-mount catalog | FR-014 | Named mount bindings |

## Constraints

- **FR-001-CON-1**: All command behavior defined in ix-local-cli FR-001 through FR-020 SHALL remain unchanged in this package except where superseded by FR-002 (display) or FR-003 (output routing).
- **FR-001-CON-2**: The package SHALL NOT import from ix-local-cli or vendor its source. All logic is co-located in `packages/local/src/`.

## Acceptance Criteria

- **FR-001-AC-1**: All commands listed in the migration table are registered under the `local` command tree.
- **FR-001-AC-2**: Acceptance criteria from ix-local-cli FR-001 through FR-020 are satisfied by the implementation in this package.
