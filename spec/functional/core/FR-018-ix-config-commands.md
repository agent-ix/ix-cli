---
id: FR-018
title: "ix config Command Group (get, set, edit, doctor)"
artifact_type: FR
object: command
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-005"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-010"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-011"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/non-functional/local/NFR-001"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

`apps/ix` SHALL register an `ix config` command group with four subcommands. All output SHALL flow through `@agent-ix/ix-ui-cli` per NFR-001.

```
ix config get [<plugin>] <key>
ix config set [<plugin>] <key> <value>
ix config edit [<plugin>]
ix config doctor
```

**`<plugin>` argument.** Optional. When omitted, the reserved id `core` is used. The plugin id MUST match a registered plugin (FR-013), otherwise the command fails with `UnknownPluginError` listing the registered plugin ids.

**`get`.** Resolves the value via the layered pipeline (FR-012) and prints it. Boolean and number values are rendered as their YAML scalar form. Object/array values are rendered as YAML. Missing keys produce a non-zero exit and a clear "key not set" message including the key path and effective default (if any).

**`set`.** Validates the proposed write against the plugin's schema (FR-013) before persisting via `ConfigService.set` (FR-010). Schema errors are rendered with plugin id, key path, expected type, and file path per NFR-005. The serialized YAML is rewritten atomically (FR-010-AC-2).

**Value parsing.** `<value>` is parsed before schema validation, with parsing mode determined by the **schema shape at the target key path** — never inferred from the argument string:

- **Scalar leaf types** (`string`, `number`, `boolean`, `enum`): the argument is passed as-is to the schema; the schema's `coerce` does the conversion (`"3"` → `3` for a number key, `"true"` → `true` for boolean).
- **Non-scalar leaf types** (`array`, `object`): the argument MUST be valid JSON and is parsed with `JSON.parse()` before schema validation. Single-quote-wrap the JSON in your shell to avoid double-quote escaping: `ix config set local cluster.defaultTags '["ix-core","ix-data"]'`.

A non-scalar key supplied with non-JSON input fails fast with `ConfigSetParseError` naming the key path and the expected JSON shape (e.g. `array<string>`); the file is not modified.

**`edit`.** Opens the plugin's config file (`ConfigService.forPlugin(...).filePath()`) in `$VISUAL` or `$EDITOR` (default `vi`). On editor exit, the file is parsed and validated; on validation failure the user is offered a re-edit loop or a discard. The file is locked (FR-011) for the duration of editing so concurrent CLI writes cannot race.

**`doctor`.** Iterates every file under `~/.config/ix/config.d/` (and the core file at `~/.config/ix/config.yaml`), validates each against its registered schema, and renders a per-plugin report:

- ✓ valid plugin (file path, key count)
- ✗ failing plugin (file path, list of `{ keyPath, expectedType, message }` errors per NFR-005)
- ? unregistered file (file present, no plugin registered for that id) — warning, not error.

`doctor` exits non-zero iff any plugin fails validation; unregistered files alone do not fail it.

## Acceptance

- **FR-018-AC-1**: `ix config get logLevel` (no plugin arg) reads from the `core` plugin's resolved config and prints the value.
- **FR-018-AC-2**: `ix config set local cluster.defaultTags '["ix-core","ix-data"]'` validates against the local schema, persists atomically, and the new value is observed by the next `ix local up`.
- **FR-018-AC-3**: `ix config set local cluster.defaultTags 42` fails with a schema error naming plugin `local`, key `cluster.defaultTags`, expected `array<string>`, and file path `~/.config/ix/config.d/local.yaml`.
- **FR-018-AC-4**: `ix config edit local` opens the file in `$EDITOR`; on save with malformed content, the user is presented with a re-edit / discard prompt; on accept, the file passes validation.
- **FR-018-AC-5**: `ix config doctor` against a tree containing one valid file and one malformed file reports both, exits non-zero, and does not crash.
- **FR-018-AC-6**: An unknown `<plugin>` argument produces `UnknownPluginError` listing all registered plugin ids and exits non-zero.
- **FR-018-AC-7**: Concurrent `ix config set local …` invocations are serialized by the per-file advisory lock (FR-011); both writes complete in order.
- **FR-018-AC-8**: For an array-typed key, `ix config set local cluster.defaultTags 'ix-core,ix-data'` (non-JSON input) fails with `ConfigSetParseError` naming the key path `cluster.defaultTags` and the expected JSON shape `array<string>`; the destination file is not modified. The same call with `'["ix-core","ix-data"]'` succeeds.
