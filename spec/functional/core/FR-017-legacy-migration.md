---
id: FR-017
title: "One-Shot Migration of Legacy Config and Credentials"
artifact_type: FR
object: migration
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-006"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-010"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-014"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-009"
    type: "supersedes"
    cardinality: "1:1"
---

## Behavior

`@agent-ix/ix-cli-core` SHALL provide a one-shot migration that runs at most once per environment, on the next `ix` invocation following an upgrade to **v0.3.0 or later** (the cutover version). Versions prior to v0.3.0 do not invoke the migration; v0.3.0+ invokes it at most once per environment regardless of which v0.3.x or later release first runs after the legacy state was last touched.

**Sources migrated.**

| Legacy path | Destination |
|---|---|
| `~/.ix/config.yaml` (top-level `cluster:` and `concurrency:` keys) | `~/.config/ix/config.d/local.yaml` |
| `~/.config/ix-local/credentials.json` (`{ ghcr_token: "..." }`) | secret id `local.ghcr-token` via `SecretsService.set` (active backend) |

**Procedure.**

1. **Probe.** Migration runs only when at least one source exists AND the destination has not yet been written by migration (tracked by a top-level `migratedFrom: legacy-v1` marker in the destination config file, plus a sentinel secret `core.migration-marker` set after a successful credentials migration).
2. **Read.** Sources are read with the existing legacy parsers (preserved for migration only); a parse failure aborts migration with a clear error and leaves all legacy files in place.
3. **Validate.** Read values are validated against the new local-package schema before write. Validation failures abort and leave legacy files in place.
4. **Write atomically.** Destinations are written via `ConfigService.set` (atomic temp+rename, `0o600`) and `SecretsService.set` (active backend). The marker is written in the same transaction as the config destination.
5. **Delete legacy.** On success, the legacy `credentials.json` file is unlinked; `~/.ix/config.yaml` is renamed to `~/.ix/config.yaml.migrated` (preserved as a one-time backup).
6. **Log.** A single user-visible note SHALL be emitted via `@agent-ix/ix-ui-cli` listing what was migrated and where.

**Idempotency.** Subsequent runs SHALL detect the marker and skip migration without re-reading the (possibly absent) sources.

**Failure isolation.** Migration failures SHALL NOT prevent the requested `ix` command from running; the user is shown a warning and can re-run after fixing the source. Plaintext legacy files are not deleted unless migration succeeded.

**Backward read prohibition.** After migration, the hot path SHALL NOT read `~/.ix/config.yaml` or `~/.config/ix-local/credentials.json`; the only code that may touch them is the migration path itself.

## Acceptance

- **FR-017-AC-1**: With both legacy files present, a single migration run produces `~/.config/ix/config.d/local.yaml` (with `cluster` and `concurrency` keys), persists `local.ghcr-token` to the active secrets backend, unlinks `credentials.json`, and renames the legacy yaml to `*.migrated`.
- **FR-017-AC-2**: A second `ix` invocation observes the marker and does not re-attempt migration; legacy paths are not read.
- **FR-017-AC-3**: A malformed legacy file aborts migration without removing legacy files; a warning is shown via ix-ui-cli.
- **FR-017-AC-4**: With no legacy files present, migration is a no-op and emits no user-visible message.
- **FR-017-AC-5**: After migration, a code grep across `packages/*/src` confirms `~/.ix/config.yaml` and `credentials.json` are referenced only inside `packages/core/src/migration/`.
- **FR-017-AC-6**: A test scan SHALL confirm the migrated GHCR token never lands in any new plaintext file (it goes only via `SecretsService.set` to keyring or `secrets.d/local.age`).
