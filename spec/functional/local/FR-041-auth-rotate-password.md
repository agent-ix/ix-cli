---
id: FR-041
title: "ix local auth rotate-password — Headless must_rotate flow"
artifact_type: FR
object: cli_command
relationships:
  - target: "ix://agent-ix/identity/FR-019"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/auth-service/FR-024"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/auth"
    type: "extends"
    cardinality: "1:1"
---
# [FR-041] `ix local auth rotate-password` — Headless must_rotate flow

## Description

Completes the must_rotate flow headlessly for legacy users (e.g. users
created by `ix local auth reset-user`). The command performs the
two-step dance previously documented as a curl snippet:

1. `POST /token` (grant_type=password) on auth-service → rotate-scoped JWT
2. `POST /users/me/password/rotate` on identity (Bearer rotate token) →
   sets new password, clears must_rotate.

Both calls go through `kubectlRaw` against the appropriate in-cluster
deployment; no public ingress.

## Synopsis

```
ix local auth rotate-password <email> --current-password-stdin (--new-password-stdin | --generate [--show-generated])
```

## Flags

| Flag | Required | Default | Description |
|---|---|---|---|
| `--current-password-stdin` | yes | — | Read the current (temporary) password from stdin line 1. |
| `--new-password-stdin` | one-of | — | Read the new password from stdin line 2. |
| `--generate` | one-of | — | Generate the new password locally. |
| `--show-generated` | no | `false` | Emit the generated new password to stderr. Implies `--generate`. |

## Errors

| Status / Step | Surface |
|---|---|
| `/token` 401 | "auth-service rejected the current password (HTTP 401)." |
| `/token` 200 but no `rotate_token` | "User is not in must_rotate state; use `ix local auth reset-user` first." |
| rotate 400 `password_policy` | Echo `detail` from identity. |
| rotate transport failure | Surface kubectl exec error verbatim. |

## Constraints

- **FR-041-CON-1**: Both calls go via `kubectlRaw`. No public ingress.
- **FR-041-CON-2**: Neither the current nor the new password appears in
  argv, stdout, stderr, logs, audit, or telemetry. `--show-generated`
  emits the new password to stderr exactly once.

## Acceptance Criteria

| ID | Criteria | Verification |
|---|---|---|
| FR-041-AC-1 | Happy path: `/token` returns `rotate_token`, `/users/me/password/rotate` returns 204; command exits 0. | Unit test |
| FR-041-AC-2 | `/token` 401 surfaces the documented message and exits non-zero. | Unit test |
| FR-041-AC-3 | `/token` 200 without `rotate_token` suggests `ix local auth reset-user`. | Unit test |
| FR-041-AC-4 | `/users/me/password/rotate` 400 `password_policy` echoes the detail. | Unit test |
| FR-041-AC-5 | Neither password sentinel ever appears in argv/stdout/stderr/notes after a successful run. | Unit test |

## Dependencies

- Upstream: identity/FR-019 (rotate endpoint), auth-service/FR-024 (rotate
  scope), auth/FR-008.
- Downstream: `apps/ix/src/commands/local/auth/rotate-password.ts`,
  `packages/local/src/commands/auth-rotate-password.tsx`,
  `packages/local/tests/auth-rotate-password.test.ts`.
