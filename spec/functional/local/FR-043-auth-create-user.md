---
id: FR-043
title: "ix local auth create-user — One-shot user creation"
artifact_type: FR
object: cli_command
relationships:
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-017"
    type: "uses"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-040"
    type: "uses"
    cardinality: "1:1"
  - target: "ix://agent-ix/auth/FR-008"
    type: "implements"
    cardinality: "1:1"
---
# [FR-043] `ix local auth create-user` — One-shot user creation

## Description

Orchestrator that combines invite (FR-017) and accept-invite (FR-040)
into a single command suitable for bots, CI, and operator quickstarts.
When `agent-browser` is on PATH the command also saves the credential to
the operator's local vault so subsequent `agent-browser` runs can log
into Filament without re-prompting.

## Synopsis

```
ix local auth create-user <email>
    --tenant <tenant-uuid>
    [--username <name>]
    [--display-name <name>]
    [--password-stdin]
    [--vault-name <name>]
    [--no-save-vault]
```

The password is generated locally when `--password-stdin` is not set; it
is never visible on stdout/stderr unless the operator opts in.

## Behavior

1. Resolve password material — stdin (line 1) or generated.
2. POST identity `/internal/users/invite` with `{email, username,
   display_name?, tenant_id}` → invite_token.
3. POST identity `/internal/users/accept-invite` with `{invite_token,
   password}` → user_id + tenant_id.
4. If `which agent-browser` succeeds AND `--no-save-vault` is not set,
   shell out: `agent-browser auth save <vault-name>
   --url http://filament-ui.dev.ix/login --username <email>
   --password-stdin` piping the password via stdin.
5. Print `{user_id, tenant_id, vault_entry: <name|null>}`.

If step 3 fails after step 2 succeeds, the command emits a recovery hint
to stderr referencing the invite token and the `uninvite` command, then
re-raises.

## Constraints

- **FR-043-CON-1**: All identity calls go via `kubectlRaw`. The
  agent-browser shell-out runs locally.
- **FR-043-CON-2**: Password material flows through process memory and
  stdin pipes only. It SHALL NOT appear in argv, stdout, stderr, log
  files, telemetry, or audit records.
- **FR-043-CON-3**: When agent-browser is missing or `--no-save-vault`
  is set, the command exits 0 with a stderr note rather than failing.

## Acceptance Criteria

| ID | Criteria | Verification |
|---|---|---|
| FR-043-AC-1 | Happy path without vault: invite + accept calls run; final Listing reports user_id, tenant_id, and "not saved". | Unit test |
| FR-043-AC-2 | Happy path with vault: `saveToVault` is called with `{vaultName, email, password}` derived from the email local-part. | Unit test |
| FR-043-AC-3 | When `agent-browser` is not on PATH, the command exits 0 and emits a stderr note. | Unit test |
| FR-043-AC-4 | When the invite step fails (e.g. 409), accept-invite is NOT called. | Unit test |
| FR-043-AC-5 | When accept-invite fails after invite succeeded, the command emits a recovery hint mentioning the invite token and `uninvite`, and re-raises. | Unit test |
| FR-043-AC-6 | The generated password never appears in argv, stdout, stderr, or ListingMock notes after a successful run. | Unit test |
| FR-043-AC-7 | `--no-save-vault` skips the vault save even when agent-browser is on PATH. | Unit test |
| FR-043-AC-8 | The `--tenant` flag is required; missing it is a hard CLI error. | oclif config |

## Dependencies

- Upstream: identity/FR-018 (invite), identity/FR-032 (accept-invite),
  agent-browser CLI.
- Downstream: `apps/ix/src/commands/local/auth/create-user.ts`,
  `packages/local/src/commands/auth-create-user.tsx`,
  `packages/local/tests/auth-create-user.test.ts`.
