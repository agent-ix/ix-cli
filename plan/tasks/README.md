# Runtime Plugin Platform Tasks

## Coordination Rules

- Keep FR-021 distribution/runtime context changes in core until the public
  shape stabilizes.
- Do not start dynamic external package loading until manifest merge and
  disable behavior are covered by tests.
- Do not mark FR-021 through FR-024 complete in `spec/tests.md` until the
  corresponding TC rows pass.
- Preserve FR-025 as complete; treat it as the foundation for the remaining
  work.

## Tracks

### Critical Path

1. `task-01-runtime-distribution.md`
2. `task-02-config-root.md`
3. `task-03-plugin-manifest-loader.md`
4. `task-04-capability-resolver.md`
5. `task-05-app-integration.md`

### Parallel Candidates

- Capability error UX details can be explored after Task 01 defines runtime
  context types.
- Documentation updates can run alongside Task 03 once manifest schema is
  stable.

## Current Status

| Task | Status |
|---|---|
| Task 01 Runtime Distribution | complete |
| Task 02 Config Root | complete |
| Task 03 Plugin Manifest Loader | complete |
| Task 04 Capability Resolver | complete |
| Task 05 App Integration | complete |

