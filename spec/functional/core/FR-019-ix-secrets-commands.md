---
id: FR-019
title: "ix secrets Command Group (list, set, rm, which)"
artifact_type: FR
object: command
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-006"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-014"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/non-functional/local/NFR-001"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

`apps/ix` SHALL register an `ix secrets` command group with four subcommands. All output SHALL flow through `@agent-ix/ix-ui-cli` per NFR-001. **No subcommand SHALL render or echo a secret value.**

```
ix secrets list
ix secrets set <id>
ix secrets rm <id>
ix secrets which <id>
```

**Id format.** `<id>` MUST match `<plugin-id>.<secret-name>` and MUST correspond to an entry in some plugin's `secretsSchema` (FR-013). Unknown ids fail with `UnknownSecretError` listing registered ids.

**`list`.** Renders one row per declared secret across all plugins:

| id | backend | source | description |
|---|---|---|---|
| `local.ghcr-token` | keyring | env / keyring / age-file / unset | "GHCR Personal Access Token …" |

The two non-id columns convey **distinct** information:

- **`backend`** — the *configured* persistence backend, from `core.secretsBackend` (FR-012). Always one of `keyring` or `age-file` regardless of whether the secret is currently set. Tells the user *where it would be stored* if they ran `ix secrets set <id>`.
- **`source`** — the *current* resolution outcome from `SecretsService.which(id)` (FR-014). One of `env` / `keyring` / `age-file` / `unset`. Tells the user *where `get` is reading from right now*. May differ from `backend` (e.g. `backend = keyring` but `source = env` when an env var is currently set; or `backend = keyring` but `source = unset` when the keyring entry hasn't been created yet).

Implementations MUST NOT conflate these columns. The value column never appears.

**`set <id>`.** Prompts for the value with masked input via ix-ui-cli (`list.pause(() => password({...}))`). Persists via `SecretsService.set` to the active backend. Confirms with a one-line note: "stored `local.ghcr-token` in keyring". An attempt to `set` a secret whose `envVar` is currently set in the environment fails with `SecretBackendImmutableError` per FR-014-AC-6.

**`rm <id>`.** Removes the persisted value via `SecretsService.delete`. If the env var is set, the command warns that the env var still satisfies `get` and exits non-zero only if `--strict` is passed.

**`which <id>`.** Prints exactly one of `env`, `keyring`, `age-file`, `unset` and exits 0 (even for `unset`).

**Error UX.** All errors include the secret id but never the value. Keyring access denials produce the same remediation hints as FR-015-AC-5.

## Acceptance

- **FR-019-AC-1**: `ix secrets list` produces a table whose value column is absent or empty for every row; a static check confirms no secret value appears in the rendered output.
- **FR-019-AC-2**: `ix secrets set local.ghcr-token` collects masked input, persists to the active backend, and prints `stored local.ghcr-token in <backend>` (no value).
- **FR-019-AC-3**: `ix secrets which local.ghcr-token` returns one of: `keyring` after `set` on a system where the keyring probe succeeds; `age-file` after `set` on a system where the keyring probe failed (file fallback active); `unset` after `rm` (or before any `set`) with no env var; `env` whenever `IX_GHCR_TOKEN` (or the declared `envVar`) is currently set, regardless of backend state.
- **FR-019-AC-4**: `ix secrets rm local.ghcr-token` clears the persisted value; `get` returns `null` (or the env var if set); `which` returns `unset` (or `env`).
- **FR-019-AC-5**: An unknown id produces `UnknownSecretError` listing every registered id and exits non-zero.
- **FR-019-AC-6**: A test scan of stdout/stderr across the full `set/list/which/rm` lifecycle confirms no secret value appears in any line of output.
- **FR-019-AC-7**: A keyring access denial during `set` surfaces a `KeyringAccessError` with platform-specific remediation; the value is not persisted and is not echoed.
