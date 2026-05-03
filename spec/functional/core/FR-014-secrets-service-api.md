---
id: FR-014
title: "SecretsService API in @agent-ix/ix-cli-core"
artifact_type: FR
object: api
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-006"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-013"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-015"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-016"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/non-functional/core/NFR-003"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

`@agent-ix/ix-cli-core` SHALL export a `SecretsService` with the following public API:

```typescript
interface SecretsService {
  get(id: SecretId, opts?: { prompt?: boolean }): Promise<string | null>;
  set(id: SecretId, value: string): Promise<void>;
  delete(id: SecretId): Promise<void>;
  which(id: SecretId): Promise<'env' | 'keyring' | 'age-file' | 'unset'>;
  list(): Promise<Array<{ id: SecretId; backend: 'keyring' | 'age-file'; description: string }>>;
}

type SecretId = `${string}.${string}`;   // "<plugin-id>.<secret-name>"
```

**SecretId runtime validation.** TypeScript's template-literal type is erased at runtime and would accept malformed ids (`"."`, `".x"`, `"a.b.c"`). Every public `SecretsService` method that accepts a `SecretId` SHALL validate it against the regex `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$` and throw `InvalidSecretIdError` on mismatch. The plugin id and secret name are each lowercase ASCII, start with a letter, contain only letters/digits/hyphens, and are separated by exactly one `.`.

**Resolution order for `get()`.** Highest precedence first:

1. **Environment variable** declared by the secret's `envVar` binding (FR-013) — e.g. `IX_GHCR_TOKEN`.
2. **Active backend** — keyring (FR-015) when capability probe succeeds, age-file (FR-016) when it does not.
3. **Interactive prompt** — only when `opts.prompt === true` and stdin/stdout is a TTY. The prompt SHALL be masked. The prompted value SHALL be persisted to the active backend after collection.
4. Otherwise, return `null`.

**`set()` and `delete()`** SHALL target the active backend; env-var-only secrets cannot be `set` (the API throws `SecretBackendImmutableError` if `envVar` is bound and set).

**Backend selection.** The active backend is chosen by the `core.secretsBackend` config value (FR-012), which defaults to `auto` (= keyring if the capability probe succeeds, else age-file). Operators may pin to `keyring` or `age-file` explicitly.

**Backend pluggability.** `SecretsService` SHALL be implemented against a `SecretsBackend` interface so that future adapters (Vault, 1Password, Bitwarden) can be registered without changing consumer code (per NFR-006). v1 ships only `keyring` and `age-file`.

**No value logging.** `SecretsService` MUST NOT log secret values, MUST NOT include them in error messages, and MUST NOT pass them to `console.*`. It SHALL render only the secret id and selected backend.

## Acceptance

- **FR-014-AC-1**: With `IX_GHCR_TOKEN=abc` set, `get('local.ghcr-token')` returns `"abc"` and `which('local.ghcr-token')` returns `"env"`, regardless of what is in any backend.
- **FR-014-AC-2**: With env unset and the value present in the active backend, `get(...)` returns the backend value.
- **FR-014-AC-3**: With env unset, no backend value, and `opts.prompt === true` on a TTY, the user is prompted with masked input; the entered value is persisted to the active backend and returned.
- **FR-014-AC-4**: With env unset, no backend value, and `opts.prompt !== true` (or non-TTY), `get(...)` returns `null` without prompting.
- **FR-014-AC-5**: `set('foo.bar', value)` followed by `delete('foo.bar')` results in `which('foo.bar') === 'unset'`.
- **FR-014-AC-6**: `set(...)` against a secret whose `envVar` binding is currently set in the environment throws `SecretBackendImmutableError`.
- **FR-014-AC-7**: A test scan of compiled output and runtime logs SHALL detect zero occurrences of any secret value emitted by `SecretsService`.
- **FR-014-AC-8**: Every public method receiving a `SecretId` validates it against `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`. Malformed ids (`"."`, `".x"`, `"x."`, `"A.b"`, `"a.b.c"`, `"a..b"`) throw `InvalidSecretIdError` naming the offending input (full input rendered, since it is, by definition, not a value).
