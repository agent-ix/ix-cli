---
id: FR-023
title: "ix logout [--host] — forget credentials"
artifact_type: FR
object: command
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "N:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-021"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-017"
    type: "calls"
    cardinality: "1:1"
---

## Description

`ix logout` forgets stored Agent IX credentials. With `--host`, it clears one
service; without it, it clears every logged-in service. Clearing deletes the
host-keyed access and refresh secrets and removes the host's
`core.auth.hosts` metadata entry, via the ix-cli-core token store
(`ix://agent-ix/ix-cli-core/FR-017`). The operation is idempotent.

## Acceptance Criteria

- **FR-023-AC-1**: `ix logout --host <host>` deletes the access secret, the
  refresh secret, and the metadata entry for `<host>`, leaving other hosts'
  credentials untouched (host isolation, `ix://agent-ix/ix-cli-core/NFR-005`).
- **FR-023-AC-2**: `ix logout` with no flag clears every logged-in host.
- **FR-023-AC-3**: `ix logout` when nothing is stored reports "nothing to do"
  and exits zero (idempotent).
- **FR-023-AC-4**: After `ix logout --host <host>`, a subsequent
  `ix whoami --host <host>` reports that host is no longer logged in.
- **FR-023-AC-5**: All output is rendered via `@agent-ix/ix-ui-cli` — no raw
  `console.log` in the command handler.

## Implementation Notes

- `apps/ix/src/commands/logout.tsx`; clears via `ixTokenStore().clear(host)` and
  enumerates targets via `loggedInHostSlugs()` from
  `apps/ix/src/auth-engine.ts`.
