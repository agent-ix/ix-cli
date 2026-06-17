---
id: US-012
title: "Developer Logs In to an Agent IX Service From the CLI"
type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-021"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-022"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-023"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **developer**, I want to run `ix login filament.dev.ix` and approve the
request in my browser, so that the CLI holds a token scoped to that service's
audience and I can use authenticated commands against it — without copy-pasting
a JWT, and without one service's credentials touching another's.

## Context

`ix login <host>` is service-first: the CLI reads
`<host>/.well-known/agentix-service.json`, runs the OAuth 2.0 Device
Authorization Grant against the service's BFF, prints a verification URL + user
code (and opens a browser best-effort), and polls until I approve in the
browser. The browser session approves through the service's same-origin BFF and
never sees a token; the CLI receives the `<host>`-audience bundle directly and
stores it host-keyed via `SecretsService` (never plaintext on disk).

The generic engine — discovery, device-flow runner, host-keyed token store with
refresh-before-expiry, and the non-fatal browser opener — is owned by
ix-cli-core (`ix://agent-ix/ix-cli-core/FR-015`, `.../FR-016`, `.../FR-017`,
`.../FR-018`). The `ix` binary supplies the IX OAuth client id, the UI
rendering, and the `core`-plugin-backed metadata store.

```bash
ix login filament.dev.ix      # device-code login; approve in browser
ix whoami                     # filament.dev.ix · audience filament · expires …
ix whoami --host filament.dev.ix
ix logout --host filament.dev.ix
ix logout                     # forget every logged-in service
```

A developer routinely logs into several services (Filament, a local cluster,
a hosted tenant). Per-host keying keeps those independent: logging out of one
never disturbs another.

## Acceptance

- **US-012-AC-1**: `ix login <host>` reads the discovery doc, runs the device
  flow, prints the verification URL + user code via `@agent-ix/ix-ui-cli`, and
  on approval reports success and persists the host-keyed token bundle
  ([FR-021-AC-1](../functional/core/FR-021-ix-login.md), [FR-021-AC-2](../functional/core/FR-021-ix-login.md)).
- **US-012-AC-2**: A denied or expired login renders a clear failure and exits
  non-zero ([FR-021-AC-3](../functional/core/FR-021-ix-login.md)).
- **US-012-AC-3**: `ix whoami` lists logged-in services with host, audience, and
  expiry and never shows a token ([FR-022](../functional/core/FR-022-ix-whoami.md)); `--host` narrows to one service.
- **US-012-AC-4**: `ix logout --host <host>` clears that host only; `ix logout`
  clears all; both are idempotent and a subsequent `ix whoami` reflects the
  change ([FR-023](../functional/core/FR-023-ix-logout.md)).
- **US-012-AC-5**: Logging into host A does not read or mutate host B's stored
  credentials (host isolation, `ix://agent-ix/ix-cli-core/NFR-005`).

## Test Coverage

| AC          | Verified by                                                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-012-AC-1 | ix-cli-core engine unit tests (discovery parse, device-flow runner, host-keyed store) + `ix login` command wiring. E2E `ix login filament.dev.ix` (in-cluster, no port-forward) — deferred to the auth integration milestone. |
| US-012-AC-2 | ix-cli-core device-flow runner ACs (`access_denied` / `expired_token`) + login failure rendering.                                                                                                                             |
| US-012-AC-3 | `ix whoami` reads `core.auth.hosts` metadata; ix-cli-core NFR-006 (no token in metadata).                                                                                                                                     |
| US-012-AC-4 | `ix logout` clears host-keyed secrets + metadata via `TokenStore.clear`.                                                                                                                                                      |
| US-012-AC-5 | ix-cli-core `FR-017-AC-1` / `NFR-005-AC-1` host-isolation tests.                                                                                                                                                              |
