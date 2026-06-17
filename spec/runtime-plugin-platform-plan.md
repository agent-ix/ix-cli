---
id: PL-001
type: Plan
name: runtime-plugin-platform
status: superseded
superseded_by: oclif-native composition (see StR-008, FR-021–FR-025 as revised 2026-05-10)
title: "Runtime Plugin Platform Plan"
---

# Runtime Plugin Platform Plan

Date: 2026-05-10

> **SUPERSEDED.** The custom plugin platform described below was implemented
> (commits `c5ac413`, `1bbcf9c`) and then retired the same week after a
> design review found that oclif's native plugin system already covers the
> intended requirements. The "load plugins before config root" constraint
> that motivated the custom layer was self-imposed (plugin discovery does
> not need the config root; only per-plugin config reads do, and those
> happen at command-run time when oclif has already parsed flags). The
> per-project plugin enable/disable feature that justified the on-disk
> manifest loader was dropped as not actually required.
>
> See the revised StR-008 and [FR-021](./functional/core/FR-021-ix-login.md)–FR-025 for the current shape:
> oclif-native plugin discovery + `@agent-ix/ix-cli-core` library
> (`BaseCommand`, `ConfigService`, `SecretsService`, `CapabilityResolver`,
> `IxPluginSchema`).

## Scope

Completed the runtime/plugin platform requirements that remained after FR-025:

- [FR-021](./functional/core/FR-021-ix-login.md) Runtime Distributions
- [FR-022](./functional/core/FR-022-ix-whoami.md) Runtime Config Root Override
- [FR-023](./functional/core/FR-023-ix-logout.md) Plugin Manifest Loading
- FR-024 Plugin Capability Binding

FR-025 is complete and provides the contract foundation: `IxPlugin`,
`registerIxPlugin`, command metadata, config schema registration, secret
registration, and capability declarations.

## Current State

- `@agent-ix/ix-cli-core` owns config, secrets, and the new `IxPlugin`
  contract.
- `apps/ix` registers `core`, `local`, and `workflow` through
  `registerIxPlugin`.
- `@agent-ix/workflow-cli-plugin` exports `workflowIxPlugin` as the first
  external plugin descriptor.
- The spec matrix marks [FR-021](./functional/core/FR-021-ix-login.md) through FR-024 test cases TC-500 through TC-515
  as complete.

## Completed Work

### 1. Runtime Distribution Model

Target: [FR-021](./functional/core/FR-021-ix-login.md), TC-500 through TC-502. Status: complete.

Add a core runtime distribution type that describes:

- binary name
- config namespace and config-root env var
- default plugin set
- whether IX services are enabled
- distribution defaults for plugin config

The main `ix` app should declare the official distribution object instead of
hard-coding plugin defaults directly in startup.

### 2. Runtime Config Root Selection

Target: [FR-022](./functional/core/FR-022-ix-whoami.md), TC-503 through TC-507. Status: complete.

Add bootstrap-time config-root resolution:

- global `--config-root <dir>`
- distribution env var such as `IX_CONFIG_ROOT`
- `--config-root` wins over env
- selected root applies before plugin bootstrap
- read paths do not create missing config roots
- write paths create config roots lazily

Project config layering and `--no-project-config` should be explicit runtime
inputs, even if the first implementation keeps project config loading narrow.

### 3. Plugin Manifest Loader

Target: [FR-023](./functional/core/FR-023-ix-logout.md), TC-508 through TC-511. Status: complete.

Add manifest parsing and layer merge:

- distribution defaults first
- user manifest second
- project manifest third
- later layers can disable earlier plugins
- validate plugin id, package specifier, enabled flag, and optional version
- isolate optional plugin load failures and report diagnostics

The first implementation can support built-in plugin module references and
local package imports before expanding into fully dynamic external package
loading.

### 4. Capability Resolver

Target: FR-024, TC-512 through TC-515. Status: complete.

Add capability resolution for plugin command execution:

- support the initial capability ids `github`, `ix-api`, and `review-service`
- distinguish missing capability, missing auth, and invalid config
- required command capabilities fail before side effects
- optional plugin capabilities do not block local-only command paths
- render capability errors through shared CLI UI and expose machine-readable
  error codes

## Suggested Implementation Order

1. Add `packages/core/src/runtime/distribution.ts` and tests for [FR-021](./functional/core/FR-021-ix-login.md).
2. Add config-root runtime context support to core config/secrets paths and app
   bootstrap, then tests for [FR-022](./functional/core/FR-022-ix-whoami.md).
3. Add manifest schema, manifest merge, and loader diagnostics for [FR-023](./functional/core/FR-023-ix-logout.md).
4. Add capability resolver and command guard helpers for FR-024.
5. Update `apps/ix` to use the distribution object and loader in its init hook.
6. Update `spec/tests.md` statuses from in-progress to complete only as tests
   land.

## Verification

Run at each completed slice:

```bash
pnpm --filter @agent-ix/ix-cli-core test
pnpm --filter @agent-ix/ix-cli-core build
pnpm --filter @agent-ix/ix test
pnpm --filter @agent-ix/ix build
pnpm -r lint
pnpm -r test
pnpm -r build
```
