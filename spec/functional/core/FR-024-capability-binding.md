---
id: FR-024
title: Per-Command Capability Binding
type: functional-requirement
related:
  - StR-008
  - US-012
---
# FR-024 Per-Command Capability Binding

Commands SHALL declare their required and optional capabilities as a
static field on the command class. `BaseCommand.prerun` SHALL resolve
those capabilities through `CapabilityResolver` and short-circuit
commands whose required capabilities are unavailable.

## Acceptance Criteria

- FR-024-AC-1: A command class declares
  `static capabilities: CommandCapabilities = { required: [...], optional: [...] }`
  using capability ids from the v1 set: `github`, `ix-api`,
  `review-service`.
- FR-024-AC-2: `BaseCommand.prerun` invokes `CapabilityResolver` against
  the declared `required` set. If any required capability is unavailable,
  the command exits with a structured error before side effects occur.
- FR-024-AC-3: Optional capabilities are surfaced through the command
  context (e.g., `this.capabilities.has('github')`) so commands can
  branch behavior; missing optional capabilities never block command
  execution.
- FR-024-AC-4: `CapabilityResolver` reads through `ConfigService` and
  `SecretsService` to determine availability — capability checks share
  the same per-package namespacing as config and secrets.
- FR-024-AC-5: Capability errors are rendered through the shared CLI UI
  error primitives and carry a machine-readable error code.

## Errors

- `capability_missing` — capability is not configured at all
- `capability_auth_missing` — capability is declared but its secret is missing
- `capability_config_invalid` — capability's config does not validate

## Notes

The earlier draft specified a custom plugin dispatch consulting a
manifest-level capability map. That has been replaced by a per-command
declaration on the class itself, enforced uniformly through
`BaseCommand.prerun`. The resolver implementation
(`packages/core/src/runtime/capabilities.ts`) is unchanged; only its
consumer is new.
