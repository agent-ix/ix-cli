# Task 01: Runtime Distribution Model

Status: superseded (see task-06)

## Scope

Add core runtime distribution types that represent reusable CLI distributions
instead of treating the main `ix` binary as a special case.

## Subtasks

- [x] **Define distribution types.** Include binary name, config namespace,
  config-root env var, default plugin set, distribution defaults, and IX service
  enablement.
- [x] **Declare main ix distribution.** Move the official `core`, `local`,
  `elements`, and `workflow` plugin bundle into an explicit distribution
  object.
- [x] **Support generic distribution tests.** Prove a generic distribution can
  disable IX services while keeping config, secrets, runtime, and plugins.

## Owns

- FR-021
- TC-500
- TC-501
- TC-502

## Dependencies

- FR-025 complete.

## Unblocks

- Task 02 config-root runtime context.
- Task 03 distribution-default plugin layer.
- Task 04 capability resolver host context.

## Deliverables

- Core runtime distribution module.
- Main `ix` distribution declaration.
- Unit tests for TC-500 through TC-502.

## Primary Tests

- TC-500
- TC-501
- TC-502

