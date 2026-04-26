---
artifact_type: master-requirements
name: ix-cli
org: agent-ix
component_type: node-cli
tags:
  - typescript
  - monorepo
  - pnpm
  - github-auth
implementation_language: typescript
depends_on: []
relationships:
  - target: "ix://agent-ix/ix-ui"
    type: "consumes"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/auth-service"
    type: "calls"
    cardinality: "1:1"

standards_alignment:
  - iso-iec-ieee-29148
  - ieee-828
---
# Master Requirements Specification
## IX CLI — Unified Agent IX Command Line Interface

---

## 1. Purpose

This document defines the **scope, intent, and governing requirements framework** for ix-cli.

It establishes:
- The problem space addressed by the unified CLI
- The boundaries of responsibility across `core`, `local`, `elements`, `spec` packages and the `ix` binary
- The authoritative structure for requirements, verification, and change control
- The plugin contract enabling third-party CLI extensions

This document is the **top-level requirements artifact** for the repository.

---

## 2. Scope

### 2.1 In Scope

This specification governs:
- The `core` package: GitHub OAuth device flow, IX service auth, `~/.ix/config.yaml` config, API HTTP clients
- The `local` package: local cluster commands (placeholder — commands migrated from ix-local-cli)
- The `elements` package: element discovery, scaffolding, and project initialization commands
- The `spec` package: spec workflow commands (create, review, run)
- The `apps/ix` binary: unified entry point composing all package command trees
- The auth credential contract: `~/.config/ix/credentials.json` storage format
- The UX contract: all terminal output routed through `@agent-ix/ix-ui-cli`
- The plugin contract: typed interface enabling third-party command packages

### 2.2 Out of Scope

This specification does not govern:
- ix-ui component rendering internals
- ix-local-cli implementation (pre-migration)
- agent-cli-daemon (session dispatcher — separate repo)
- Hosted cluster infrastructure or deployment pipelines
- Web dashboard or API server concerns

---

## 3. System Overview

### 3.1 System Description

ix-cli is a **pnpm workspace monorepo** that composes domain packages into a single `ix` binary for the Agent IX ecosystem. It is the primary interface through which developers interact with local clusters, elements, and spec workflows.

Package structure:

| Package | Name | Responsibility |
|---------|------|----------------|
| `packages/core` | `@agent-ix/ix-cli-core` | Auth (GitHub + IX), config, HTTP clients |
| `packages/local` | `@agent-ix/ix-cli-local` | Local cluster commands (`ix up`, `ix down`) |
| `packages/elements` | `@agent-ix/ix-cli-elements` | Element commands (`ix elements init`, `ix elements list`) |
| `packages/spec` | `@agent-ix/ix-cli-spec` | Spec workflow commands (`ix spec create`, `ix spec run`) |
| `apps/ix` | `@agent-ix/ix` | Unified binary — registers all package command trees |

### 3.2 Intended Users

- **Developers** running Agent IX apps locally via `ix up <app>`
- **Teams** scaffolding new microservices via `ix elements init`
- **Spec authors** running spec workflows via `ix spec`
- **Third-party plugin authors** building on the ix plugin contract

---

## 4. Requirements Architecture

```
spec/
├── spec.md                     # This document
├── stakeholder/                # StR-XXX
├── usecase/                    # US-XXX
├── functional/                 # FR-XXX
├── non-functional/             # NFR-XXX
├── tests.md                    # Bidirectional requirements ↔ tests mapping
└── assets/                     # Diagrams, sequence flows
```

---

## 5. Requirement Classes

### 5.1 Stakeholder Requirements (`StR-XXX`)
Authoritative needs from developers, teams, and plugin authors.

### 5.2 User Stories (`US-XXX`)
Usage scenarios describing developer intent when running ix commands.

### 5.3 Functional Requirements (`FR-XXX`)
Testable behavioral contracts for each package, command, and auth flow.

### 5.4 Non-Functional Requirements (`NFR-XXX`)
Quality constraints: security, output style consistency, credential handling.

---

## 6. Requirement Identification

| Artifact | Format | Example |
|----------|--------|---------|
| Stakeholder Requirement | `StR-XXX` | `StR-001` |
| User Story | `US-XXX` | `US-002` |
| Functional Requirement | `FR-XXX` | `FR-014` |
| Non-Functional Requirement | `NFR-XXX` | `NFR-003` |
| Acceptance Criteria | `{FR}-AC-N` | `FR-014-AC-1` |
| Test Case | `TC-XXX` | `TC-021` |

Identifiers are immutable once assigned.

---

## 7. Requirement Quality Policy

All functional requirements SHALL:
- Define observable behavior
- Be unambiguous and atomic
- Be testable through explicit criteria
- Reference the responsible package (`core`, `local`, `elements`, `spec`, or `ix`)

---

## 8. Auth and Configuration Model

### 8.1 Credential Storage

Auth credentials are stored at `~/.config/ix/credentials.json` (mode `0o600`).

The credential contract is owned by `core` and shared with agent-cli-daemon. Format:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": "<ISO8601>"
}
```

### 8.2 Auth Flows

| Flow | Provider | Trigger |
|------|----------|---------|
| GitHub OAuth device flow | GitHub | `ix login --github` |
| IX service token | IX auth-service | `ix login` (default) |

Both flows are implemented in `packages/core/auth/`.

### 8.3 Configuration

User configuration is stored at `~/.ix/config.yaml`. The schema is owned by `packages/core/config/`.

---

## 9. Command Tree

### 9.1 Top-Level Commands

```
ix login              # authenticate (IX service + optional GitHub)
ix logout             # revoke credentials
ix whoami             # show authenticated user

ix up <app>           # deploy app to local cluster (packages/local)
ix down <app>         # tear down app from local cluster (packages/local)

ix elements init      # scaffold new element from registry (packages/elements)
ix elements list      # list available elements (packages/elements)

ix spec create        # initialize spec for current repo (packages/spec)
ix spec run           # run spec workflow (packages/spec)
ix spec review        # review spec quality (packages/spec)
```

### 9.2 UX Contract

All commands SHALL:
- Use `@agent-ix/ix-ui-cli` for all terminal output
- Never call `console.log` or `process.stdout.write` directly in command handlers
- Use `@clack/prompts` intro/outro framing (via ix-ui-cli wrappers)

Multi-service progress commands (e.g., `ix up <app>`) SHALL use the `PhaseTable` component from `@agent-ix/ix-ui-cli`.

---

## 10. Plugin Contract

Third-party packages MAY extend ix-cli by satisfying the `IxPlugin` interface exported from `@agent-ix/ix-cli-core`:

```ts
interface IxPlugin {
  name: string
  commands: CommandTree
  requires?: ('github' | 'ix-api')[]
}
```

`requires` declares auth dependencies — `core` resolves tokens before the command runs.

---

## 11. Error and Failure Model

- Auth errors (expired token, missing credentials) SHALL produce a clear message directing to `ix login`
- Network errors to IX services SHALL surface the service name and suggest remediation
- Command errors SHALL exit with non-zero status codes
- All errors SHALL be rendered via `@agent-ix/ix-ui-cli` error primitives — no raw `console.error`

---

## 12. Traceability

Bidirectional traceability SHALL be maintained between:
- Stakeholder Requirements → Functional Requirements
- Functional Requirements → Acceptance Criteria → Test Cases

---

## 13. Verification Strategy

- `core`: unit tests for auth flows (with mock HTTP), config loading, token refresh
- `local`: integration tests against local cluster (kind)
- `elements`: unit tests with mock element registry responses
- `spec`: unit tests for workflow orchestration
- `apps/ix`: e2e command tests via CLI invocation

---

## 14. Open Questions

| # | Question | Status |
|---|----------|--------|
| 1 | Adopt oclif as plugin framework or build custom command registration? | Open |
| 2 | How does `ix up` determine target cluster (local vs hosted)? Flag or config? | Open |
| 3 | Element registry location — npm.ix package, hosted API, or git repo? | Open |

---

## 15. References

- ISO/IEC/IEEE 29148 — Requirements Engineering
- IEEE 828 — Configuration Management
- ix-local-cli spec — reference implementation for local cluster commands
- agent-cli-daemon src/auth.ts — OAuth device flow reference implementation
- ix-ui spec — UX component contracts
