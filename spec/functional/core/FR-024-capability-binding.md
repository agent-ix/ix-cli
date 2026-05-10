---
id: FR-024
title: Plugin Capability Binding
type: functional-requirement
related:
  - StR-008
  - US-012
---
# FR-024 Plugin Capability Binding

The system SHALL let plugins declare required and optional capabilities that
the host distribution resolves during command execution.

## Acceptance Criteria

- FR-024-AC-1: Plugin manifests or plugin modules can declare required
  capabilities such as `github`, `ix-api`, or `review-service`.
- FR-024-AC-2: Commands requiring unavailable mandatory capabilities fail with
  a structured error before side effects occur.
- FR-024-AC-3: Optional capabilities can be absent without preventing local-only
  commands from running.
- FR-024-AC-4: Capability resolution uses host config and secrets services.
- FR-024-AC-5: Capability errors are rendered through shared CLI UI error
  primitives and are available in machine-readable output.

## Errors

- `capability_missing`
- `capability_auth_missing`
- `capability_config_invalid`

