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

### 1.1 Relationship to ix-cli-core (the CLI framework)

The **generic CLI framework** — `ConfigService`, `SecretsService`, the plugin
schema contract (`ixSchema`), the runtime (`BaseCommand`, `CapabilityResolver`,
config-root resolution, oclif-native composition), and the `config` / `secrets`
command runners — is **NOT specified in this repository**. It is specified in
[`agent-ix/ix-cli-core`](https://github.com/agent-ix/ix-cli-core) and consumed
here as the `@agent-ix/ix-cli-core` library.

Framework requirements are referenced from this spec in the form
`ix://agent-ix/ix-cli-core/<ID>` (for example
`ix://agent-ix/ix-cli-core/FR-001` is the `ConfigService` API, and
`ix://agent-ix/ix-cli-core/FR-005` is the `SecretsService` API). The old-style
inline shorthands (`FR-011`, `FR-014`, etc.) in §8–§10 below have been
repointed to their `ix://agent-ix/ix-cli-core/...` form. The ix-cli-core →
ix-cli ID mapping is:

| Framework concern | ix-cli-core ID |
|---|---|
| ConfigService API | `ix://agent-ix/ix-cli-core/FR-001` |
| Per-plugin file isolation | `ix://agent-ix/ix-cli-core/FR-002` |
| Layered config resolution | `ix://agent-ix/ix-cli-core/FR-003` |
| Plugin schema registration | `ix://agent-ix/ix-cli-core/FR-004` |
| SecretsService API | `ix://agent-ix/ix-cli-core/FR-005` |
| OS keyring backend | `ix://agent-ix/ix-cli-core/FR-006` |
| Encrypted-file fallback | `ix://agent-ix/ix-cli-core/FR-007` |
| `config` command group | `ix://agent-ix/ix-cli-core/FR-008` |
| `secrets` command group | `ix://agent-ix/ix-cli-core/FR-009` |
| CLI binary composition | `ix://agent-ix/ix-cli-core/FR-010` |
| Runtime config-root override | `ix://agent-ix/ix-cli-core/FR-011` |
| Plugin discovery (oclif-native) | `ix://agent-ix/ix-cli-core/FR-012` |
| Per-command capability binding | `ix://agent-ix/ix-cli-core/FR-013` |
| ixSchema plugin convention | `ix://agent-ix/ix-cli-core/FR-014` |
| No plaintext secrets | `ix://agent-ix/ix-cli-core/NFR-001` |
| Sensitive-file permissions | `ix://agent-ix/ix-cli-core/NFR-002` |
| Schema-error UX | `ix://agent-ix/ix-cli-core/NFR-003` |
| Secrets backend pluggability | `ix://agent-ix/ix-cli-core/NFR-004` |
| Pluggable-config stakeholder need | `ix://agent-ix/ix-cli-core/StR-001` |
| Secrets-never-plaintext stakeholder need | `ix://agent-ix/ix-cli-core/StR-002` |
| Reusable-CLI-runtime stakeholder need | `ix://agent-ix/ix-cli-core/StR-003` |
| Run-custom-CLI-distribution use case | `ix://agent-ix/ix-cli-core/US-001` |

What **remains** ix-cli's own is **FR-020** — the concrete `core` plugin
`configSchema` / `secretsSchema` (auth.serviceUrl, GitHub/IX tokens, telemetry,
theme, update-check). FR-020 declares IX's specific `core` namespace using the
framework's plugin contract.

---

## 2. Scope

### 2.1 In Scope

This specification governs:
- The IX `core` plugin schema: the concrete `configSchema` / `secretsSchema` for the reserved `core` id (GitHub/IX auth tokens, auth.serviceUrl, telemetry, theme, update-check) — see FR-020
- IX service auth flows: GitHub OAuth device flow, IX service auth, token refresh
- The `local` package: local cluster commands (placeholder — commands migrated from ix-local-cli)
- The `elements` package: element discovery, scaffolding, and project initialization commands
- The `spec` package: spec workflow commands (create, review, run)
- The `apps/ix` binary: unified entry point composing all package command trees
- The UX contract: all terminal output routed through `@agent-ix/ix-ui-cli`

### 2.2 Out of Scope

This specification does not govern:
- **The generic CLI framework** (`ConfigService`, `SecretsService`, the `ixSchema` plugin contract, `BaseCommand` / `CapabilityResolver` runtime, and the generic `config` / `secrets` command runners) — these are specified in `agent-ix/ix-cli-core` and referenced as `ix://agent-ix/ix-cli-core/<ID>` (see §1.1)
- ix-ui component rendering internals
- ix-local-cli implementation (pre-migration)
- agent-cli-daemon (session dispatcher — separate repo)
- Hosted cluster infrastructure or deployment pipelines
- Web dashboard or API server concerns

---

## 3. System Overview

### 3.1 System Description

ix-cli is a **pnpm workspace monorepo** that composes domain packages into a single `ix` binary for the Agent IX ecosystem. It is the primary interface through which developers interact with local clusters, elements, and spec workflows. Every package and the binary depend on `@agent-ix/ix-cli-core` — the generic CLI framework, extracted to its own repo (see §1.1) — for config, secrets, the plugin contract, and the runtime.

Package structure:

| Package | Name | Responsibility |
|---------|------|----------------|
| (external) | `@agent-ix/ix-cli-core` | Generic CLI framework (config/secrets/plugin/runtime). Specified in `agent-ix/ix-cli-core`; consumed as a library. |
| `packages/local` | `@agent-ix/ix-cli-local` | Local cluster commands (`ix up`, `ix down`) |
| `packages/elements` | `@agent-ix/ix-cli-elements` | Element commands (`ix elements init`, `ix elements list`) |
| `apps/ix` | `@agent-ix/ix` | Unified binary — IX auth flows (GitHub + IX service), the reserved `core` plugin schema (FR-020), and registration of all package command trees |

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

Each persisted file owned by ix-cli is mode `0o600`, written atomically (temp + rename), and refused on read if its mode is wider. Per-plugin file isolation guarantees that a malformed or buggy plugin's config cannot corrupt unrelated plugins (`ix://agent-ix/ix-cli-core/FR-002`). The config and secrets storage machinery referenced throughout this section is specified in ix-cli-core; this section documents how the IX `ix` binary uses it.

**Cluster-targeting state out of scope for `core`.** Cluster context (which cluster, kubeconfig context, kind cluster name, internal/external base domains) lives in the `local` plugin's schema for v1, NOT in `core`. The promotion of cluster targeting to `core` is gated on hosted Agent IX clusters landing and is tracked in [agent-ix/ix-cli#2](https://github.com/agent-ix/ix-cli/issues/2). FR-020 enumerates the v1 contents of `core`'s `configSchema` and `secretsSchema`.

### 8.2 Configuration Service

Configuration is owned by the `ConfigService` in `@agent-ix/ix-cli-core`:

- Plugins access only their own file via `ConfigService.forPlugin(id, schema)` — the API does not expose cross-plugin reads.
- Schemas are Zod `.strict()`; unknown keys are rejected at write time.
- Layered resolution: env (`IX_*` per plugin's declared bindings) → plugin's `config.d/<id>.yaml` → schema defaults (`ix://agent-ix/ix-cli-core/FR-003`).
- The reserved id `core` is the only plugin allowed to read or write `~/.config/ix/config.yaml`.
- A parse or validation error on one plugin's file SHALL NOT block other plugins; the offending plugin falls back to schema defaults and the error is surfaced via `ix config doctor` (`ix://agent-ix/ix-cli-core/FR-002`, `ix://agent-ix/ix-cli-core/FR-008`).

### 8.3 Secrets Service

Secrets (GHCR PAT, IX auth refresh token, future plugin secrets) are owned by `SecretsService` in `@agent-ix/ix-cli-core`:

- **Default backend: OS keyring** via `@napi-rs/keyring` — `service = "ix-cli"`, `account = "<plugin-id>.<secret-name>"` (`ix://agent-ix/ix-cli-core/FR-006`).
- **Fallback backend: per-plugin age-encrypted blobs** at `secrets.d/<plugin-id>.age` with X25519 identity at `secrets.key` (`ix://agent-ix/ix-cli-core/FR-007`). Used only when the keyring capability probe fails.
- Resolution order for `get()`: env (`IX_*` per plugin's declared `envVar`) → active backend → optional masked TTY prompt (`ix://agent-ix/ix-cli-core/FR-005`).
- **No secret value is ever persisted in plaintext on disk** (`ix://agent-ix/ix-cli-core/NFR-001`).
- Backend pluggability: future Vault / 1Password / Bitwarden adapters register via a typed `SecretsBackend` interface without changes to consumers (`ix://agent-ix/ix-cli-core/NFR-004`).

### 8.4 Auth Flows

| Flow | Provider | Trigger | Token Storage |
|---|---|---|---|
| GitHub OAuth device flow | GitHub | `ix login --github` | SecretsService secret `core.github-token` |
| IX service token | IX auth-service | `ix login` (default) | SecretsService secrets `core.auth-access-token`, `core.auth-refresh-token`; `core.auth-expires-at` is a config value |

Both flows are implemented in `packages/core/src/auth/`.

### 8.5 No Legacy Compatibility

ix-cli is pre-release and has no installed user base whose state needs preserving across the v0.3.0 cutover. The new ConfigService / SecretsService stores are the only system of record; there is no migration shim from earlier `~/.ix/config.yaml` or `~/.config/ix-local/credentials.json` layouts. Operators upgrading from a pre-v0.3.0 build SHALL re-create their config and re-enter their secrets via `ix config set` and `ix secrets set`.

### 8.6 Runtime Config Root Override

`--config-root` is a base flag on `BaseCommand` (defined in
`@agent-ix/ix-cli-core` — the override behavior is specified by
`ix://agent-ix/ix-cli-core/FR-011`); oclif parses it normally through the
standard flag system. `IX_CONFIG_ROOT` is its environment-variable alias.
The selected root applies to per-plugin config reads and file-backed
secrets when a command runs.

Supported forms:

```bash
ix workflow status --config-root /tmp/ix-ci
IX_CONFIG_ROOT=/tmp/ix-ci ix workflow status
```

`--config-root` wins over `IX_CONFIG_ROOT`; the env variable wins over
the XDG default. Project config still layers above the selected user
config root unless a command is run with `--no-project-config`.

Effective precedence:

```text
flags > env > project config (./.ix) > selected user config root > schema defaults
```

There is no argv preprocessing in the bin script, so the root-position
form `ix --config-root /tmp/ix-ci ...` is not supported. An earlier
draft stripped `--config-root` from `process.argv` before oclif loaded;
that bypass has been superseded — see `ix://agent-ix/ix-cli-core/FR-011`
notes and the follow-up review in
`spec/reviews/runtime-plugin-addendum-review.md`.

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

> The plugin contract itself (the `ixSchema` convention, capability binding,
> oclif-native composition, and trust model) is **specified in ix-cli-core** —
> see `ix://agent-ix/ix-cli-core/FR-014` (ixSchema), `.../FR-013` (capability
> binding), `.../FR-010` (binary composition), and `.../FR-012` (plugin
> discovery). This section summarizes how the `ix` binary applies that
> contract; it is not the authoritative definition.

ix-cli plugins are **normal oclif plugins** — npm packages discovered by
oclif via the binary's `oclif.plugins` config (or installed at runtime
through `@oclif/plugin-plugins`). The IX-specific layering is two small
conventions on top of oclif:

1. **`ixSchema` named export.** Plugins that need namespaced config,
   secrets, or env-var bindings export an `ixSchema` object from their
   package main. The host's `init` hook (provided by
   `@agent-ix/ix-cli-core`) walks `Config.plugins`, reads each plugin's
   `ixSchema` if present, and registers schemas with `ConfigService` /
   `SecretsService`.

2. **`static capabilities` on command classes.** Commands that depend on
   `github`, `ix-api`, or `review-service` declare their requirements
   on the command class; `BaseCommand.prerun` resolves them.

```ts
// @agent-ix/ix-cli-core
export interface IxPluginSchema {
  id?: string;                       // optional config/secrets namespace
  config?: ZodObject<ZodRawShape>;   // MUST be .strict() — see ix-cli-core/FR-004
  secrets?: SecretDeclaration[];
  env?: Record<string, string>;
}

export interface SecretDeclaration {
  name: string;                       // full id is "<plugin-id>.<name>"
  description: string;
  required?: boolean;
  envVar?: string;                    // optional env binding
}

export interface CommandCapabilities {
  required?: ('github' | 'ix-api' | 'review-service')[];
  optional?: ('github' | 'ix-api' | 'review-service')[];
}
```

- Plugin install/load identity is the **npm package name**, not a custom
  registry tag.
- Config and secret namespacing uses `ixSchema.id` when provided,
  otherwise a safe id derived from the package name.
- `ixSchema.config`, when present, is registered through
  `ConfigService.forPlugin(pluginId)` and read from
  `<config-root>/config.d/<plugin-id>.yaml`. The schema MUST be `.strict()`
  (`ix://agent-ix/ix-cli-core/FR-004`).
- `ixSchema.secrets`, when present, registers entries through
  `SecretsService` under `<plugin-id>.<secret-name>`.
- The package name `@agent-ix/ix-cli-core` is reserved for the shared
  library itself; the bin package may use a `core` namespace for its
  own config without conflict because no plugin can claim that name.

The earlier draft defined a custom `IxPlugin` interface and
`registerIxPlugin()` runtime registry duplicating oclif's plugin
discovery. That has been retired — see
`spec/runtime-plugin-platform-plan.md` and
`spec/reviews/runtime-plugin-addendum-review.md`.

### 10.1 Trust Model

ix-cli plugins run **in-process** with full Node.js privileges (`node:fs`, `node:child_process`, env vars, `process.binding`). The plugin contract MUST NOT be read as adversarial isolation:

- Per-plugin file isolation in `config.d/` and `secrets.d/` defends against **accidental corruption** from buggy plugins, not against deliberate exfiltration. A malicious plugin can read another plugin's config file directly via `node:fs`; nothing in this spec prevents that.
- The `ConfigService.forPlugin(id, schema)` API takes `id` as a string. Cross-plugin reads are not API-blocked at runtime; the contract that "each plugin reads its own id" is enforced by **static-check lint only** (`ix://agent-ix/ix-cli-core/FR-003`-AC-5).
- This posture matches every other in-process plugin CLI (gh, kubectl, aws-cli, oclif, helm, VS Code extensions). The only major dev CLI that achieves real plugin isolation is Terraform, via subprocess + gRPC.
- Adversarial isolation (subprocess-per-plugin RPC) is tracked as future work in [agent-ix/ix-cli#1](https://github.com/agent-ix/ix-cli/issues/1).

**Operator guidance.** Install only plugins you trust. Treat `ix` plugins with the same care as `gh` extensions or `kubectl-*` binaries on your `PATH`.

### 10.2 CLI Binary Composition

An IX CLI binary is a normal oclif application that:

```text
Any IX CLI
  oclif binary
    + dependency: @agent-ix/ix-cli-core (BaseCommand, ConfigService,
                  SecretsService, CapabilityResolver, IxPluginSchema)
    + oclif.plugins: [<plugin packages this binary ships>]
```

The main `ix` binary lists the official Agent IX plugins
(`@agent-ix/ix-cli-elements`, `@agent-ix/ix-cli-local`,
`@agent-ix/workflow-cli-plugin`) in its `oclif.plugins`. A generic CLI
ships a smaller list. An IX-connected CLI ships whichever IX service
plugins it needs. There is no `Distribution` runtime object — the binary
itself is the distribution.

Per-command capability requirements (`ix://agent-ix/ix-cli-core/FR-013`) are
declared as `static capabilities` on the command class and enforced by
`BaseCommand.prerun`. Commands requiring unavailable mandatory
capabilities fail with a structured error before side effects occur.

There is no on-disk plugin manifest. Per-project plugin enable/disable
is not supported — users who want a different plugin set ship or
install a different binary.

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
