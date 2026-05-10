# Task 04: Capability Resolver

Status: complete

## Scope

Resolve required and optional plugin command capabilities against host services,
config, and secrets before command execution.

## Subtasks

- [x] **Define capability resolver API.** Include `github`, `ix-api`, and
  `review-service` as the initial supported capability ids.
- [x] **Add command guard helper.** Commands with missing mandatory
  capabilities fail before side effects.
- [x] **Preserve optional behavior.** Optional capabilities do not block
  local-only command paths.
- [x] **Expose structured errors.** Include `capability_missing`,
  `capability_auth_missing`, and `capability_config_invalid` for human and JSON
  output.

## Owns

- FR-024
- TC-512
- TC-513
- TC-514
- TC-515

## Dependencies

- Task 01 runtime distribution model.
- Task 02 config-root selection.
- Task 03 plugin manifest loader.

## Unblocks

- Task 05 main app integration.

## Deliverables

- Capability resolver module.
- Command guard helper.
- Error types/rendering tests.

## Primary Tests

- TC-512
- TC-513
- TC-514
- TC-515

