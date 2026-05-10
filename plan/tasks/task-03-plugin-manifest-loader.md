# Task 03: Plugin Manifest Loader

Status: complete

## Scope

Parse, validate, merge, and load plugin manifest layers from distribution
defaults, selected user config root, and project config root.

## Subtasks

- [x] **Define manifest schema.** Validate plugin id, package specifier,
  enabled flag, and optional version.
- [x] **Merge layers.** Apply distribution, user, then project order; allow
  later layers to disable earlier plugins.
- [x] **Load plugin modules.** Support built-in module references first, with
  isolated diagnostics for optional failures.
- [x] **Register loaded plugins.** Feed loaded `IxPlugin` descriptors through
  `registerIxPlugin`.

## Owns

- FR-023
- TC-508
- TC-509
- TC-510
- TC-511

## Dependencies

- Task 01 runtime distribution model.
- Task 02 config-root selection.

## Unblocks

- Task 04 capability resolver.
- Task 05 main app integration through loader path.

## Deliverables

- Plugin manifest types and parser.
- Layer merge implementation.
- Loader diagnostics.
- Unit tests for TC-508 through TC-511.

## Primary Tests

- TC-508
- TC-509
- TC-510
- TC-511

