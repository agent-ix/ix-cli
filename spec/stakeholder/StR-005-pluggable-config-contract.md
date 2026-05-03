---
id: StR-005
title: "Pluggable Config Contract with Per-Plugin Isolation"
artifact_type: StR
relationships: []
---

## Stakeholder Need

Today every `ix-cli` package that needs persistent configuration rolls its own loader: `packages/local/src/config.ts` and `packages/local/src/pool.ts` parse `~/.ix/config.yaml` ad-hoc, `packages/elements` keeps `~/.config/ix/elements-taps.yaml`, and the cache is yet another path. Plugins (third-party packages satisfying `IxPlugin` from `@agent-ix/ix-cli-core`) have no shared way to declare a config shape, so every new plugin re-implements YAML reading, path-picking, and validation. This guarantees drift, makes `ix config` impossible to implement uniformly, and means a single bad write to a shared file can corrupt config belonging to unrelated plugins.

**Stakeholders** — first-party package authors (local/elements/spec) and third-party plugin authors — need:

1. A single, schema-validated config service in `@agent-ix/ix-cli-core` that every package and plugin uses.
2. A way for each plugin to declare its config shape once (a typed/Zod schema) and have ix-cli enforce it on read and write.
3. **Physical isolation per plugin**: each plugin's config is stored in its own file under `~/.config/ix/config.d/<plugin-id>.yaml`, so a malformed or buggy plugin cannot corrupt config belonging to other plugins, and concurrent `ix` invocations editing different plugins never contend on the same file.
4. Uniform `ix config get/set/edit/doctor` commands that work for any plugin without per-plugin code.

## Priority

Must-Have

## Acceptance

- **StR-005-AC-1**: A single `ConfigService` API in `@agent-ix/ix-cli-core` is the only sanctioned way to read or write persistent CLI configuration; `packages/local`, `packages/elements`, and `apps/ix` use it exclusively.
- **StR-005-AC-2**: A plugin declares its config shape via an optional `configSchema` field on `IxPlugin`; ix-cli validates writes against that schema and rejects unknown keys.
- **StR-005-AC-3**: Each plugin's persisted config lives in its own file under `~/.config/ix/`. Third-party and first-party plugins use `~/.config/ix/config.d/<plugin-id>.yaml`; the reserved `core` plugin (owned by `apps/ix`) uses `~/.config/ix/config.yaml`. The same per-file isolation guarantees apply to both paths.
- **StR-005-AC-4**: A parse or validation error in one plugin's config file SHALL NOT prevent any other plugin from loading; the affected plugin falls back to schema defaults and the error is surfaced via `ix config doctor`.
- **StR-005-AC-5**: `ix config get/set/edit/doctor` commands operate uniformly across all registered plugins with no per-plugin command code.
