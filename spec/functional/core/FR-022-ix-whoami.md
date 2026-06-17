---
id: FR-022
title: "ix whoami [--host] — show authenticated sessions"
type: FR
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

`ix whoami` reports which Agent IX services the CLI is currently logged in to,
reading the host-keyed token metadata persisted by `ix login`
(`ix://agent-ix/ix-cli-core/FR-017`, stored in `core.auth.hosts`). With
`--host`, output is limited to a single service host. The command never renders
a token value (`ix://agent-ix/ix-cli-core/NFR-006`).

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-022-AC-1 | With no logged-in services, `ix whoami` reports "not logged in" and points the user at `ix login <host>`; exit zero. | Test |
| FR-022-AC-2 | With one or more logged-in services, each is listed with its host, audience, and access-token expiry (and an expired marker when past `expiresAt`). No token value appears. | Test |
| FR-022-AC-3 | `ix whoami --host <host>` shows only that host; an unknown host reports "not logged in to that host" and exits zero. | Test |
| FR-022-AC-4 | All output is rendered via `@agent-ix/ix-ui-cli` — no raw `console.log` in the command handler. | Test |


- **FR-022-AC-1**: With no logged-in services, `ix whoami` reports "not logged
  in" and points the user at `ix login <host>`; exit zero.
- **FR-022-AC-2**: With one or more logged-in services, each is listed with its
  host, audience, and access-token expiry (and an expired marker when past
  `expiresAt`). No token value appears.
- **FR-022-AC-3**: `ix whoami --host <host>` shows only that host; an unknown
  host reports "not logged in to that host" and exits zero.
- **FR-022-AC-4**: All output is rendered via `@agent-ix/ix-ui-cli` — no raw
  `console.log` in the command handler.

## Implementation Notes

- `apps/ix/src/commands/whoami.tsx`; reads metadata via `ixTokenStore().peekMeta`
  and `loggedInHostSlugs()` from `apps/ix/src/auth-engine.ts`.

## Dependencies

- **implements**: ix-cli/spec/stakeholder/StR-001
- **requires**: ix-cli/spec/functional/core/FR-021
- **calls**: ix-cli-core/spec/functional/FR-017
