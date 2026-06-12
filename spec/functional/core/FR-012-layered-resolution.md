---
id: FR-012
title: "Layered Config Resolution: Env → Plugin File → Defaults"
artifact_type: FR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-005"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-010"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

`ConfigService.forPlugin(...).get()` SHALL resolve effective values from the following layers, highest precedence first:

1. **Environment variables** declared by the plugin's schema via Zod metadata or a sibling `envBindings` map (e.g. `IX_LOG_LEVEL` for `core.logLevel`, `IX_GHCR_REGISTRY` for `local.registry`). Env values are coerced and validated by the same schema.
2. **The plugin's user-config file** at `~/.config/ix/config.d/<pluginId>.yaml`.
3. **Schema defaults** as declared by the Zod schema.

Env-variable bindings are conventionally `IX_*` and SHALL be declared by the plugin (not hardcoded in core), so a plugin can choose its own envvar names while still benefiting from layered resolution.

**Core-only settings.** Settings owned by `apps/ix` itself (log level, secrets backend choice, telemetry opt-in, etc.) are persisted under the reserved plugin id `core` at `~/.config/ix/config.yaml` (note: file directly named `config.yaml`, not under `config.d/`). The reserved id `core` is the only plugin allowed to write that path.

**Project-local layer (deferred to v2).** A `./.ix/config.d/<pluginId>.yaml` layer between env and user file is explicitly out of scope for v1; the resolution pipeline is structured to admit it later without API change.

## Acceptance

- **FR-012-AC-1**: With `IX_LOG_LEVEL=debug` set and `~/.config/ix/config.yaml` containing `logLevel: info`, `forPlugin('core', S).get().logLevel === 'debug'`.
- **FR-012-AC-2**: With `IX_LOG_LEVEL` unset and `~/.config/ix/config.yaml` containing `logLevel: info`, `get().logLevel === 'info'`.
- **FR-012-AC-3**: With both env and file absent, `get()` returns the schema-declared default for each key.
- **FR-012-AC-4**: An invalid env-variable value (e.g. `IX_LOG_LEVEL=loud`) raises `ConfigSchemaError` with the env var name and expected enum.
- **FR-012-AC-5**: Plugin-source code outside `apps/ix/` and `packages/core/` SHALL contain zero call sites of the form `ConfigService.forPlugin('core', ...)` or `forPlugin('<other-plugin-id>', ...)` (verified by static check). The `ConfigService` API does NOT runtime-reject such calls — see spec.md §10 trust model — but a static lint enforces the soft contract that each plugin only reads its own id.
