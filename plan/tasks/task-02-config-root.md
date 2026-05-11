# Task 02: Runtime Config Root Selection

Status: superseded (see task-06)

## Scope

Resolve runtime config roots from global flag and environment before plugin
bootstrap, and thread the selected roots through config, secrets, and manifest
loading.

## Subtasks

- [x] **Parse config-root inputs.** Add support for `--config-root` and the
  distribution env var, with flag precedence.
- [x] **Thread runtime paths.** Make config and file-backed secrets read from
  selected runtime paths without changing schema semantics.
- [x] **Preserve lazy creation.** Reads use defaults without creating missing
  roots; writes create required directories lazily.
- [x] **Model project config.** Add explicit `--no-project-config` behavior and
  project-over-user layering inputs.

## Owns

- FR-022
- TC-503
- TC-504
- TC-505
- TC-506
- TC-507

## Dependencies

- Task 01 runtime distribution model.

## Unblocks

- Task 03 user/project manifest loading.
- Task 04 capability resolver config/secrets reads.

## Deliverables

- Runtime config-root resolver.
- Config/secrets path integration.
- App command/global flag integration.

## Primary Tests

- TC-503
- TC-504
- TC-505
- TC-506
- TC-507

