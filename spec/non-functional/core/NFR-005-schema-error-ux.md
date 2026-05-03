---
id: NFR-005
title: "Schema Validation Errors Are Actionable"
artifact_type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-005"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-010"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-018"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/non-functional/local/NFR-001"
    type: "requires"
    cardinality: "1:1"
---

## Statement

Every config validation error surfaced by `ConfigService`, `ix config set`, `ix config edit`, or `ix config doctor` SHALL identify all four of:

1. **Plugin id** (e.g. `local`)
2. **Key path** within the schema, dot-notated (e.g. `cluster.defaultTags`)
3. **Expected type** in human-readable form (e.g. `array<string>`, `enum: debug|info|warn|error`, `string matching /^v?\d+\.\d+\.\d+$/`)
4. **File location** — absolute path of the config file (e.g. `/home/user/.config/ix/config.d/local.yaml`)

Errors SHALL also include the **observed value** (rendered safely; objects truncated at 80 chars), unless the offending key is declared as a secret in `secretsSchema` (in which case the value is replaced with `<redacted>`).

Errors are rendered through `@agent-ix/ix-ui-cli` (`list.error(...)`) per NFR-001 and never via `console.error` directly.

**Aggregate doctor output.** `ix config doctor` SHALL aggregate all validation errors per plugin and render them in a stable, scriptable order (sorted by plugin id, then key path). The exit code is non-zero iff any plugin has at least one error.

**No raw Zod traces.** The user-facing message MUST NOT show raw Zod `issues[]` JSON or stack traces. Internal Zod issues SHALL be translated into the four-tuple above by a single `formatSchemaError(pluginId, filePath, issues)` helper.

## Rationale

A plugin author or operator hitting a config error needs to fix it without reading the codebase. The four-tuple is the minimum information that pinpoints a fix: which plugin, which key, what's expected, where the file lives. Hiding values for declared secrets prevents `ix config doctor` from leaking a token if a misconfiguration nudges one into the wrong store.

## Acceptance Criteria

- **NFR-005-AC-1**: Setting `local.cluster.defaultTags` to `42` produces an error whose rendered text contains all of: `local`, `cluster.defaultTags`, `array<string>`, and the absolute path to `config.d/local.yaml`.
- **NFR-005-AC-2**: An error rendered for a key declared in `secretsSchema` SHALL contain `<redacted>` in place of the observed value; a static check confirms the actual value is not present in the rendered output.
- **NFR-005-AC-3**: `ix config doctor` against two failing plugins emits errors in `(pluginId, keyPath)` ascending order; output is byte-stable across runs given identical inputs.
- **NFR-005-AC-4**: A static grep across `packages/*/src/` SHALL find zero invocations of `console.error` for schema errors; all paths route through ix-ui-cli.
- **NFR-005-AC-5**: A static grep SHALL find zero call sites that render Zod's raw `issues[]` JSON; only `formatSchemaError` produces user-facing strings.

## Verification

- Unit tests in `packages/core/tests/schema-error-format.test.ts` exercise every Zod error variant the codebase emits and assert the four-tuple shape.
- A snapshot test for `ix config doctor` output guards stable ordering (NFR-005-AC-3).
