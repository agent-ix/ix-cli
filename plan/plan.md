# Implementation Plan: Runtime Plugin Platform

## Requirements Summary

### Stakeholder Requirements

- [x] **StR-008**: Reusable CLI runtime supports generic, IX-connected, and
  main `ix` distributions with layered plugin sets.

### User Stories

- [x] **US-012**: Tool authors can build custom CLI distributions using the
  shared runtime, config, secrets, plugin loading, and terminal style.

### Functional Requirements

- [x] **FR-021**: Runtime distributions declare binary identity, default
  plugins, IX service enablement, and distribution defaults.
- [x] **FR-022**: Runtime config root can be selected by global flag or env
  before plugin bootstrap.
- [x] **FR-023**: Plugin manifests load from distribution, user, and project
  layers with later-layer disable support.
- [x] **FR-024**: Plugin capabilities are resolved by the host before command
  execution.
- [x] **FR-025**: `IxPlugin` command/config/secrets/capability contract exists
  and is consumed by the main `ix` app and workflow plugin.

## Dependency Graph

### Core Dependency Edges

- `FR-025 -> FR-021, FR-023, FR-024`
  Reason: distribution defaults, manifest loading, and capability binding all
  need the normalized plugin contract already added in core.
- `FR-021 -> FR-022, FR-023, FR-024`
  Reason: config-root env name, IX service enablement, defaults, and built-in
  plugin set are distribution properties.
- `FR-022 -> FR-023`
  Reason: user/project plugin manifests must be read from the selected runtime
  config roots before plugin loading.
- `FR-022 -> FR-024`
  Reason: capability resolution reads config and secrets from the selected
  runtime roots.
- `FR-023 -> FR-024`
  Reason: the resolver evaluates the capabilities declared by loaded plugins
  and their command metadata.

### Shared Dependencies

- Runtime context is shared by FR-021, FR-022, FR-023, and FR-024. It should be
  a discrete core deliverable that carries distribution, config-root,
  project-config, and service-capability inputs.
- Manifest layer merge is shared by distribution bootstrap and future dynamic
  external plugin loading.
- Capability diagnostics are shared by human UI rendering and machine-readable
  JSON output.

### Cross-Cutting Constraints

- Existing config/secrets isolation specs still apply: plugin config remains
  namespaced under config roots and plugin secrets remain namespaced by plugin
  id.
- Plugin loading remains in-process and trust-based per `spec/spec.md` section
  10.1.
- Main `ix` must keep using `@agent-ix/ix-ui-cli` primitives for command-facing
  errors.

## Test Plan

### Unit Tests

- [x] **TC-500** (FR-021): Generic distribution starts with config, secrets,
  runtime, and no IX service layer.
- [x] **TC-501** (FR-021): Main `ix` distribution declares the official default
  plugin bundle.
- [x] **TC-502** (FR-021): Distribution defaults lose to user/project config,
  env, and flags.
- [x] **TC-505** (FR-022): `--config-root` wins over `IX_CONFIG_ROOT`.
- [x] **TC-506** (FR-022): Project config layers above selected user config
  root unless `--no-project-config` is set.
- [x] **TC-507** (FR-022): Read command with missing config root uses schema
  defaults without creating files.
- [x] **TC-508** (FR-023): Plugin loader applies distribution, user, then
  project order.
- [x] **TC-509** (FR-023): Project manifest disables a plugin enabled by
  distribution defaults.
- [x] **TC-510** (FR-023): Plugin manifest validates id, package, enabled
  state, and optional version.
- [x] **TC-511** (FR-023): Optional plugin load failure is reported without
  blocking unrelated plugins.
- [x] **TC-512** (FR-024): Plugin declares `github`, `ix-api`, and
  `review-service` capabilities.
- [x] **TC-514** (FR-024): Optional missing capability does not block local-only
  workflow command.
- [x] **TC-515** (FR-024): Capability resolver uses `ConfigService` and
  `SecretsService`.

### Command Tests

- [x] **TC-503** (FR-022): `ix --config-root <dir> config get logLevel` reads
  selected root.
- [x] **TC-504** (FR-022): `IX_CONFIG_ROOT=<dir> ix config get logLevel` reads
  selected root.
- [x] **TC-513** (FR-024): Mandatory missing capability fails before side
  effects and renders a structured error.

### Completed Regression Tests

- [x] **TC-600 through TC-608** (FR-025): `IxPlugin` contract, registration,
  app init, and workflow adapter coverage.

## Completed Work

### Track A: Critical Path

#### A1: Runtime Distribution Model

- **Scope:** Add distribution types and default plugin bundle declarations.
- **Difficulty:** Medium.
- **Exit criteria:** TC-500 through TC-502 pass.

#### A2: Runtime Config Root Selection

- **Scope:** Resolve config roots from global flag/env and pass them into
  config, secrets, and plugin bootstrap.
- **Difficulty:** Hard.
- **Depends on:** A1.
- **Exit criteria:** TC-503 through TC-507 pass.

#### A3: Plugin Manifest Loader

- **Scope:** Parse, validate, merge, and load plugin manifest layers.
- **Difficulty:** Hard.
- **Depends on:** A1, A2.
- **Exit criteria:** TC-508 through TC-511 pass.

#### A4: Capability Resolver

- **Scope:** Resolve required/optional capabilities for loaded plugin commands.
- **Difficulty:** Medium.
- **Depends on:** A1, A2, A3.
- **Exit criteria:** TC-512 through TC-515 pass.

### Quality Gates

#### Gate: Bootstrap Order

- **Measures:** Runtime parses config-root inputs before config/secrets/plugin
  bootstrap.
- **Pass criteria:** TC-503, TC-504, and TC-505 pass in the same run.
- **If fails:** Stop manifest loader work and fix runtime context propagation.

#### Gate: First External Plugin

- **Measures:** `workflowIxPlugin` loads through the same path as built-in
  plugins and reads selected config.
- **Pass criteria:** workflow command adapter tests and app static checks pass.
- **If fails:** Fix manifest normalization before adding broader capability
  behavior.

## Parallel Execution Summary

```text
Track A: FR-021 distribution -> FR-022 config root -> FR-023 manifest -> FR-024 capability
Track B: Capability error UX design can start after FR-021 types stabilize
Track C: Dynamic package loading extensions wait until FR-023 merge behavior is proven
```

## Task File Mapping

| Task | Track | Status | Owns |
|---|---|---|---|
| `plan/tasks/task-01-runtime-distribution.md` | A1 | complete | FR-021 |
| `plan/tasks/task-02-config-root.md` | A2 | complete | FR-022 |
| `plan/tasks/task-03-plugin-manifest-loader.md` | A3 | complete | FR-023 |
| `plan/tasks/task-04-capability-resolver.md` | A4 | complete | FR-024 |
| `plan/tasks/task-05-app-integration.md` | A4/Gate | complete | FR-021 through FR-024 |

## Verification Commands

```bash
pnpm --filter @agent-ix/ix-cli-core test
pnpm --filter @agent-ix/ix-cli-core build
pnpm --filter @agent-ix/ix test
pnpm --filter @agent-ix/ix build
pnpm -r lint
pnpm -r test
pnpm -r build
```
