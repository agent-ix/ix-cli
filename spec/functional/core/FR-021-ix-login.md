---
id: FR-021
title: "ix login <host> — service-first device login"
artifact_type: FR
object: command
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "N:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-020"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-015"
    type: "calls"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-016"
    type: "calls"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-017"
    type: "calls"
    cardinality: "1:1"
---

## Description

`ix login <host>` authenticates the user to an Agent IX service via the OAuth
2.0 Device Authorization Grant and stores a host-keyed, audience-scoped token
bundle. This command is **IX wiring over the generic engine**: the discovery
client (`ix://agent-ix/ix-cli-core/FR-015`), device-flow runner
(`ix://agent-ix/ix-cli-core/FR-016`), and host-keyed token store
(`ix://agent-ix/ix-cli-core/FR-017`) all live in ix-cli-core. This command
supplies the IX OAuth client id, renders the verification prompt through
`@agent-ix/ix-ui-cli`, and persists the bundle through the IX `core` plugin's
`SecretsService` + `core.auth.hosts` config metadata (FR-020).

`<host>` is whatever the user passes (e.g. `filament.dev.ix`); there is no
hard-coded IX service. Discovery is read from
`<host>/.well-known/agentix-service.json`.

## Acceptance Criteria

- **FR-021-AC-1**: `ix login <host>` fetches the service discovery document for
  `<host>`, runs the device flow, and on approval persists the access token,
  refresh token, and `{expiresAt, audience, scope}` metadata keyed by `<host>`.
- **FR-021-AC-2**: The verification URI and user code are rendered prominently
  via `@agent-ix/ix-ui-cli` (no raw `console.log`). The browser is opened
  best-effort; `--no-browser` suppresses the attempt and the URL is shown for
  manual entry.
- **FR-021-AC-3**: A denied approval (`access_denied`) and an expired device
  code (`expired_token`) each render a clear failure Listing and exit non-zero.
- **FR-021-AC-4**: Plain-HTTP discovery is refused for non-`.dev.ix` hosts
  unless `--insecure` is passed; `*.dev.ix` hosts are allowed over HTTP
  (delegated to `ix://agent-ix/ix-cli-core/NFR-005`).
- **FR-021-AC-5**: The stored token value is never echoed to the terminal and
  never written to config metadata (only the secrets backend holds it —
  `ix://agent-ix/ix-cli-core/NFR-006`).

## Implementation Notes

- `apps/ix/src/commands/login.tsx`; engine wiring in
  `apps/ix/src/auth-engine.ts` (`ixTokenStore()`, `CoreConfigTokenMetaStore`).
- IX OAuth client id: `ix-cli` (`IX_DEVICE_CLIENT_ID`).
- Secret ids are `core.auth-access-token-<slug>` /
  `core.auth-refresh-token-<slug>` where `<slug>` is the slugified host.
