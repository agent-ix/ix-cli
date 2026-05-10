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

FRs and NFRs are organized by package within each artifact directory (Option B artifact-first):

```
spec/
├── spec.md                     # This document
├── stakeholder/                # StR-XXX  (cross-cutting)
├── usecase/                    # US-XXX   (cross-cutting)
├── functional/
│   ├── local/                  # FR-XXX   (@agent-ix/ix-cli-local)
│   ├── core/                   # FR-XXX   (@agent-ix/ix-cli-core)      [future]
│   ├── elements/               # FR-XXX   (@agent-ix/ix-cli-elements)  [future]
│   └── spec/                   # FR-XXX   (@agent-ix/ix-cli-spec)      [future]
├── non-functional/
│   └── local/                  # NFR-XXX  (@agent-ix/ix-cli-local)
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

### 8.1 Storage Layout (XDG-compliant)

```
~/.config/ix/
├── config.yaml              # core-only CLI settings (id "core")
├── secrets.key              # X25519 age identity (mode 0600; only when keyring unavailable)
├── config.d/
│   ├── local.yaml           # @agent-ix/ix-cli-local config
│   ├── elements.yaml        # @agent-ix/ix-cli-elements config
│   ├── spec.yaml            # @agent-ix/ix-cli-spec config
│   └── <plugin-id>.yaml     # any third-party plugin
└── secrets.d/
    ├── local.age            # per-plugin age-encrypted blob (mode 0600)
    ├── elements.age
    └── <plugin-id>.age
```

Each persisted file owned by ix-cli is mode `0o600`, written atomically (temp + rename), and refused on read if its mode is wider. Per-plugin file isolation guarantees that a malformed or buggy plugin's config cannot corrupt unrelated plugins (FR-011).

**Cluster-targeting state out of scope for `core`.** Cluster context (which cluster, kubeconfig context, kind cluster name, internal/external base domains) lives in the `local` plugin's schema for v1, NOT in `core`. The promotion of cluster targeting to `core` is gated on hosted Agent IX clusters landing and is tracked in [agent-ix/ix-cli#2](https://github.com/agent-ix/ix-cli/issues/2). FR-020 enumerates the v1 contents of `core`'s `configSchema` and `secretsSchema`.

### 8.2 Configuration Service

Configuration is owned by the `ConfigService` in `@agent-ix/ix-cli-core`:

- Plugins access only their own file via `ConfigService.forPlugin(id, schema)` — the API does not expose cross-plugin reads.
- Schemas are Zod `.strict()`; unknown keys are rejected at write time.
- Layered resolution: env (`IX_*` per plugin's declared bindings) → plugin's `config.d/<id>.yaml` → schema defaults (FR-012).
- The reserved id `core` is the only plugin allowed to read or write `~/.config/ix/config.yaml`.
- A parse or validation error on one plugin's file SHALL NOT block other plugins; the offending plugin falls back to schema defaults and the error is surfaced via `ix config doctor` (FR-011, FR-018).

### 8.3 Secrets Service

Secrets (GHCR PAT, IX auth refresh token, future plugin secrets) are owned by `SecretsService` in `@agent-ix/ix-cli-core`:

- **Default backend: OS keyring** via `@napi-rs/keyring` — `service = "ix-cli"`, `account = "<plugin-id>.<secret-name>"` (FR-015).
- **Fallback backend: per-plugin age-encrypted blobs** at `secrets.d/<plugin-id>.age` with X25519 identity at `secrets.key` (FR-016). Used only when the keyring capability probe fails.
- Resolution order for `get()`: env (`IX_*` per plugin's declared `envVar`) → active backend → optional masked TTY prompt (FR-014).
- **No secret value is ever persisted in plaintext on disk** (NFR-003).
- Backend pluggability: future Vault / 1Password / Bitwarden adapters register via a typed `SecretsBackend` interface without changes to consumers (NFR-006).

### 8.4 Auth Flows

| Flow | Provider | Trigger | Token Storage |
|---|---|---|---|
| GitHub OAuth device flow | GitHub | `ix login --github` | SecretsService secret `core.github-token` |
| IX service token | IX auth-service | `ix login` (default) | SecretsService secrets `core.auth-access-token`, `core.auth-refresh-token`; `core.auth-expires-at` is a config value |

Both flows are implemented in `packages/core/src/auth/`.

### 8.5 No Legacy Compatibility

ix-cli is pre-release and has no installed user base whose state needs preserving across the v0.3.0 cutover. The new ConfigService / SecretsService stores are the only system of record; there is no migration shim from earlier `~/.ix/config.yaml` or `~/.config/ix-local/credentials.json` layouts. Operators upgrading from a pre-v0.3.0 build SHALL re-create their config and re-enter their secrets via `ix config set` and `ix secrets set`.

### 8.6 Runtime Config Root Override

The shared CLI runtime supports runtime selection of the user-level config root
before plugin bootstrap. This enables generic CLI distributions, IX-connected
CLI distributions, CI runs, and tests to isolate config and file-backed secrets
without changing the command implementation.

Supported forms:

```bash
ix --config-root /tmp/ix-ci workflow status
IX_CONFIG_ROOT=/tmp/ix-ci ix workflow status
```

`--config-root` wins over the config-root env var. Project config still layers
above the selected user config root unless a command is run with
`--no-project-config`.

Effective precedence:

```text
flags > env > project config > selected user config root > distribution defaults > schema defaults
```

---

## 9. Command Tree

### 9.1 Top-Level Commands

```
ix login              # authenticate (IX service + optional GitHub)
ix logout             # revoke credentials
ix whoami             # show authenticated user

ix up <app>           # deploy app to local cluster (packages/local)
ix down <app>         # tear down app from local cluster (packages/local)

ix elements list                     # list available element types (packages/elements)
ix elements init <type> <name>       # scaffold new project from element (packages/elements)
ix elements new <name>               # author a new element type (packages/elements)
ix elements tap add <github-url>     # add an element tap source (packages/elements)
ix elements tap remove <github-url>  # remove a tap source (packages/elements)
ix elements tap list                 # list configured taps (packages/elements)

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
  id: string                              // unique plugin id; namespaces config + secrets
  commands: CommandTree
  requires?: ('github' | 'ix-api')[]
  configSchema?: ZodObject<any>           // MUST be Zod .strict() — see FR-013
  secretsSchema?: SecretDeclaration[]
}

interface SecretDeclaration {
  name: string                            // local name; full id is "<pluginId>.<name>"
  description: string                     // shown by `ix secrets list` and prompts
  required?: boolean                      // when true, login flow will prompt
  envVar?: string                         // optional env binding (e.g. "IX_GHCR_TOKEN")
}
```

- `requires` declares auth dependencies — `core` resolves tokens before the command runs.
- `configSchema`, when present, namespaces and validates the plugin's persistent config under `~/.config/ix/config.d/<id>.yaml` via `ConfigService` (FR-010, FR-013). The schema MUST be `.strict()` so unknown keys are rejected at write time.
- `secretsSchema`, when present, declares the secrets the plugin may read/write under ids `<id>.<name>` via `SecretsService` (FR-013, FR-014). Each entry is shown in `ix secrets list` with its description.
- The id `core` is reserved for `apps/ix` itself; third-party plugins MUST NOT use it (FR-013-AC-4).

### 10.1 Trust Model

ix-cli plugins run **in-process** with full Node.js privileges (`node:fs`, `node:child_process`, env vars, `process.binding`). The plugin contract MUST NOT be read as adversarial isolation:

- Per-plugin file isolation in `config.d/` and `secrets.d/` defends against **accidental corruption** from buggy plugins, not against deliberate exfiltration. A malicious plugin can read another plugin's config file directly via `node:fs`; nothing in this spec prevents that.
- The `ConfigService.forPlugin(id, schema)` API takes `id` as a string. Cross-plugin reads are not API-blocked at runtime; the contract that "each plugin reads its own id" is enforced by **static-check lint only** (FR-012-AC-5).
- This posture matches every other in-process plugin CLI (gh, kubectl, aws-cli, oclif, helm, VS Code extensions). The only major dev CLI that achieves real plugin isolation is Terraform, via subprocess + gRPC.
- Adversarial isolation (subprocess-per-plugin RPC) is tracked as future work in [agent-ix/ix-cli#1](https://github.com/agent-ix/ix-cli/issues/1).

**Operator guidance.** Install only plugins you trust. Treat `ix` plugins with the same care as `gh` extensions or `kubectl-*` binaries on your `PATH`.

### 10.2 Runtime Distributions And Plugin Sets

The CLI runtime is reusable across multiple distributions:

```text
Generic CLI
  runtime + config/secrets + selected local plugins

IX-connected CLI
  runtime + config/secrets + ix-services + selected IX plugins

Main ix CLI
  runtime + config/secrets + ix-services + official default plugin bundle
```

Distribution default plugins load first, user-enabled plugins load next, and
project-enabled plugins load last. Later layers can disable a plugin from an
earlier layer. Plugin entries include plugin id, package specifier, enabled
state, and optional version constraint.

Plugins can declare required and optional capabilities. Commands that require
unavailable mandatory capabilities fail before side effects occur. Optional
capabilities can be absent for local-only command paths.

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
| 1 | Adopt oclif as plugin framework or build custom command registration? | Resolved — oclif (already in use) |
| 2 | How does `ix up` determine target cluster (local vs hosted)? Flag or config? | Open |
| 3 | Element registry location — npm.ix package, hosted API, or git repo? | Resolved — git tap model: `github.com/<org>` taps discovered via `ix-elements/registry.yaml` index or `topic:ix-element` GitHub search; spec/spec.md frontmatter is the element manifest |

---

## 15. References

- ISO/IEC/IEEE 29148 — Requirements Engineering
- IEEE 828 — Configuration Management
- ix-local-cli spec — reference implementation for local cluster commands
- agent-cli-daemon src/auth.ts — OAuth device flow reference implementation
- ix-ui spec — UX component contracts
