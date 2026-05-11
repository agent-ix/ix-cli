# Implementation Plan: Runtime Plugin Platform

> **Status: SUPERSEDED (2026-05-10).** The runtime plugin platform described
> below was implemented (`c5ac413`, `1bbcf9c`, `eaf1ba6`) and is being
> retired in favor of oclif-native composition. The revised StR-008 and
> FR-021–FR-025 capture the current shape; see
> `spec/runtime-plugin-platform-plan.md` and
> `spec/reviews/runtime-plugin-addendum-review.md` for the retrospective.
>
> The implementation tasks below remain only for historical traceability.
> A new task series for the oclif-native migration lives at the bottom of
> this file.

## Requirements Summary

### Stakeholder Requirements

- [x] **StR-008**: (rewritten) Reusable CLI runtime composes
  `@agent-ix/ix-cli-core` + oclif plugins; no parallel plugin platform.

### User Stories

- [x] **US-012**: (rewritten) Tool authors build a normal oclif binary
  depending on `@agent-ix/ix-cli-core` and list IX plugins in
  `oclif.plugins`.

### Functional Requirements

- [x] **FR-021**: (rewritten) IX CLI binary = oclif binary using
  `@agent-ix/ix-cli-core` + `oclif.plugins`. No `Distribution` registry.
- [x] **FR-022**: (rewritten) `--config-root` is a normal `BaseCommand`
  base flag parsed by oclif. No argv preprocessing.
- [x] **FR-023**: (rewritten / largely retired) Plugin discovery via
  `oclif.plugins`; no on-disk plugin manifest.
- [x] **FR-024**: (rewritten) Per-command `static capabilities` declared
  on the command class; `BaseCommand.prerun` invokes `CapabilityResolver`.
- [x] **FR-025**: (rewritten) `ixSchema` named export convention replaces
  the `IxPlugin` runtime registry.

## Cross-Cutting Constraints

- Existing config/secrets isolation specs still apply: plugin config remains
  namespaced under config roots and plugin secrets remain namespaced by
  npm package name (the new identity, replacing the old plugin id).
- Plugin loading uses oclif's discovery; trust model is oclif's.
- Main `ix` keeps using `@agent-ix/ix-ui-cli` primitives for command-facing
  errors and rendering.

## Task File Mapping (legacy)

| Task | Track | Status | Owns |
|---|---|---|---|
| `plan/tasks/task-01-runtime-distribution.md` | A1 | superseded | FR-021 |
| `plan/tasks/task-02-config-root.md` | A2 | superseded | FR-022 |
| `plan/tasks/task-03-plugin-manifest-loader.md` | A3 | superseded | FR-023 |
| `plan/tasks/task-04-capability-resolver.md` | A4 | partially reused | FR-024 |
| `plan/tasks/task-05-app-integration.md` | A4/Gate | superseded | FR-021–FR-024 |

## New Migration Task Series

See `plan/tasks/task-06-oclif-native-migration.md` for the active plan.
The migration covers:

1. Delete custom `IxPlugin` registry, manifest loader, distribution
   object, bin-level argv preprocessing, and `Command.baseFlags` mutation.
2. Add `BaseCommand` with `--config-root` / `--no-project-config` base
   flags and capability-resolution `prerun`.
3. Move built-in plugins into `apps/ix/package.json` `oclif.plugins`.
4. Replace init-hook plugin registration with an `ixSchema` walker over
   `Config.plugins`.
5. Honor `--config-root` in `packages/elements/` (replace `os.homedir()`
   with `configRoot()`/`cacheRoot()`).
6. Declare `static capabilities` on commands that need guards.

## Verification Commands

```bash
make lint
make test
make build

# Oclif natively parses the flag:
node apps/ix/bin/ix.js --help                  # --config-root native
node apps/ix/bin/ix.js plugins                 # lists oclif plugins
node apps/ix/bin/ix.js config get logLevel --config-root /tmp/ix-smoke
IX_CONFIG_ROOT=/tmp/ix-smoke node apps/ix/bin/ix.js config get logLevel

# Elements writes under custom root:
node apps/ix/bin/ix.js elements tap add foo bar --config-root /tmp/ix-smoke
ls /tmp/ix-smoke/elements-taps.yaml
```
