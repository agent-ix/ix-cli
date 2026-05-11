# Task 05: Main ix App Integration

Status: superseded (see task-06)

## Scope

Switch the main `ix` bootstrap from direct plugin registration to the runtime
distribution, config-root, manifest-loader, and capability resolver path.

## Subtasks

- [x] **Use the ix distribution object.** Replace hard-coded built-in plugin
  registration in app init with distribution bootstrap.
- [x] **Register workflow through loader path.** Keep `workflowIxPlugin` as the
  first external proving plugin.
- [x] **Wire config-root into commands.** Ensure workflow/config/secrets
  commands observe the selected runtime context.
- [x] **Update spec matrix.** Mark TC-500 through TC-515 complete only after
  passing tests land.

## Owns

- Integration coverage for FR-021 through FR-024.

## Dependencies

- Task 01 runtime distribution model.
- Task 02 config-root selection.
- Task 03 plugin manifest loader.
- Task 04 capability resolver.

## Unblocks

- Marking FR-021 through FR-024 complete in `spec/tests.md`.

## Deliverables

- App init bootstrap update.
- Runtime context integration.
- Matrix status update.

## Primary Tests

- TC-500 through TC-515
- Existing FR-025 regression coverage

