---
id: FR-021
title: Runtime Distributions
type: functional-requirement
related:
  - StR-008
  - US-012
---
# FR-021 Runtime Distributions

The system SHALL model each CLI binary as a distribution of the shared runtime
with its own binary name, config namespace, branding, default plugin set, and
optional IX service layer.

## Acceptance Criteria

- FR-021-AC-1: A distribution can declare default plugins that load without
  user configuration.
- FR-021-AC-2: A distribution can disable the IX service layer and still use
  config, secrets, plugin loading, and terminal UI primitives.
- FR-021-AC-3: The main `ix` distribution declares the official Agent IX plugin
  bundle.
- FR-021-AC-4: Distribution defaults are lower precedence than user/project
  config, env vars, and flags.

## Notes

The main `ix` CLI is not a special engine. It is the official distribution of
the shared runtime.

