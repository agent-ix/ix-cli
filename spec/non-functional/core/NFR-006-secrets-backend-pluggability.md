---
id: NFR-006
title: "Secrets Backend Adapter Pluggability"
artifact_type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-006"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-014"
    type: "requires"
    cardinality: "1:1"
---

## Statement

`SecretsService` SHALL be implemented against a `SecretsBackend` interface so that additional adapters (HashiCorp Vault, 1Password, Bitwarden, AWS/GCP Secret Manager, etc.) can be added in future versions without changes to consumer code.

**Interface contract.**

```typescript
interface SecretsBackend {
  readonly id: 'keyring' | 'age-file' | string;       // additional ids reserved for future
  probe(): Promise<{ available: boolean; reason?: string }>;
  get(secretId: SecretId): Promise<string | null>;
  set(secretId: SecretId, value: string): Promise<void>;
  delete(secretId: SecretId): Promise<void>;
  list(): Promise<Array<{ secretId: SecretId }>>;
}
```

**Selection.** The active backend is selected by `core.secretsBackend` (FR-012):

- `auto` — keyring if `probe()` succeeds, else age-file.
- `keyring` — pin to keyring; if `probe()` fails, every secret op throws.
- `age-file` — pin to age-file regardless of keyring availability.
- (future) `vault`, `1password`, `bitwarden`, etc. — registered by future adapter packages; their `id` strings are reserved.

**Consumer constraints.**

- Consumers (`packages/local`, `packages/elements`, third-party plugins) SHALL only call the public `SecretsService` API. They MUST NOT import `SecretsBackend` implementations directly.
- A static check SHALL prevent `import.*backends/(keyring|age-file)` from any file outside `packages/core/src/secrets/`.

**Adapter packaging.** v1 ships only `keyring` and `age-file` as in-tree backends. Future external adapters (e.g. `@agent-ix/ix-cli-secrets-vault`) register via a documented `registerSecretsBackend(adapter: SecretsBackend)` entrypoint exposed from core. A registered backend whose `id` is already taken throws.

**Forward compatibility.** Adding a new backend SHALL NOT require changes to:

- `packages/local/src/credentials.ts` (consumer)
- `apps/ix/src/commands/secrets/*` (CLI surface)
- `IxPlugin.secretsSchema` shape (declarative metadata)
- `SecretsService` public method signatures

## Rationale

Today's open question is "keyring vs Vault vs Bitwarden". The answer for v1 is keyring + age-file because that's the model `gh`, `aws`, `gcloud` use and it's the minimum that solves the plaintext problem. But teams will eventually want centralized rotation, audit, and dynamic GHCR PATs from Vault — and individual users may prefer Bitwarden or 1Password sync. A backend adapter interface keeps that door open with zero refactor risk to consumers.

## Acceptance Criteria

- **NFR-006-AC-1**: A test harness defines a `MemoryBackend` satisfying `SecretsBackend`, registers it via `registerSecretsBackend`, sets `core.secretsBackend = "memory"`, and exercises `set/get/delete/list/which` end-to-end without any change to `SecretsService` or its consumers.
- **NFR-006-AC-2**: Consumers (`packages/local/src/credentials.ts`, plugin code) compile and pass tests against the unchanged `SecretsService` API when `core.secretsBackend` switches between `keyring` and `age-file`.
- **NFR-006-AC-3**: A static grep SHALL find zero imports of `secrets/backends/*` from outside `packages/core/src/secrets/`.
- **NFR-006-AC-4**: Registering two backends with the same `id` throws on the second registration; the first remains active.
- **NFR-006-AC-5**: With `core.secretsBackend = "keyring"` pinned and the probe failing, every `SecretsService` operation throws `KeyringUnavailableError` (no silent fallback to age-file).

## Verification

- Unit tests in `packages/core/tests/secrets-backend-pluggability.test.ts` implement NFR-006-AC-1, NFR-006-AC-2, NFR-006-AC-4, NFR-006-AC-5 with the in-test `MemoryBackend`.
- A static-check test enforces NFR-006-AC-3 via grep.
