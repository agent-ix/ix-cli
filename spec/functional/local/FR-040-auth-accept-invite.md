---
id: FR-040
title: "ix local auth accept-invite — Headless invite acceptance"
type: FR
relationships:
  - target: "ix://agent-ix/identity/FR-032"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/auth/FR-008"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/auth"
    type: "extends"
    cardinality: "1:1"
---
# FR-040: `ix local auth accept-invite` — Headless invite acceptance

## Description

Headless consumption of an invite token issued by `ix local auth invite`
(FR-017). Operators run this from CI, scripts, or interactive shells to set
a user's initial password and clear the invite without using a browser. The
command targets identity's [FR-032](./FR-032-ghcr-creds-autoprovision.md) endpoint
(`POST /internal/users/accept-invite`) via `kubectlRaw`; no public ingress
traffic is permitted.

Per auth/[FR-008-CON-11](./FR-008-ix-core-tag-convention.md) (strengthened wording) the new password SHALL NOT
appear on the command line. The command requires exactly one of
`--password-stdin` or `--generate`.

## Synopsis

```
ix local auth accept-invite <token> (--password-stdin | --generate [--show-generated])
```

## Flags

| Flag | Required | Default | Description |
|---|---|---|---|
| `--password-stdin` | one-of | — | Read the new password from stdin (first line). |
| `--generate` | one-of | — | Generate a strong random password (32 chars). |
| `--show-generated` | no | `false` | When set, print the generated password to stderr after success. Implies `--generate`. |

Specifying neither `--password-stdin` nor `--generate` (or both) is a hard
error.

## Behavior

1. Resolve the password material (stdin or generator).
2. POST `{invite_token, password}` to identity's `/internal/users/accept-invite`
   via `kubectlRaw` (kubeconfig-gated).
3. On 200, print `{user_id, tenant_id, must_rotate?}`. Access/refresh tokens
   returned by identity are **never** printed.
4. On error, surface a human-readable mapping per the table below.

## Errors

| Status | Code | Surface |
|---|---|---|
| 400 | `invalid_token` | "Invite token is invalid, consumed, superseded, or expired." |
| 400 | `password_policy` | Echo the `detail` field from identity. |
| 403 | `admin_not_acceptable_headlessly` | "Admin invitations must use the cloud-manager-ui browser flow per [FR-008-CON-1](./FR-008-ix-core-tag-convention.md)." |
| 410 | `token_rate_limited` | "This token has been attempted too many times; request a fresh invite." |
| 429 | `rate_limited` | "Rate-limited; retry after `Retry-After` seconds." |
| 500 | `no_default_tenant` | "Legacy user without a default tenant; run `ix local auth tenant set-default <email>` first." |

## Constraints

- **FR-040-CON-1**: The command SHALL only reach identity via
  `kubectlRaw`. No `fetch`, port-forward, or ingress HTTP.
- **FR-040-CON-2**: The password SHALL NOT appear in argv, stdout, audit
  records, telemetry, or log files. When `--show-generated` is set the
  generated value is emitted to **stderr only**.
- **FR-040-CON-3**: When identity returns `access_token` or
  `refresh_token` they SHALL be discarded by ix-cli, not printed.

## Acceptance Criteria

| ID | Criteria | Verification |
|---|---|---|
| FR-040-AC-1 | Running without `--password-stdin` or `--generate` exits non-zero with a clear message. | Unit test |
| FR-040-AC-2 | A 200 response writes a Listing containing the user_id and tenant_id and exits 0. | Unit test |
| FR-040-AC-3 | Each documented error envelope maps to the documented operator-facing message. | Unit test |
| FR-040-AC-4 | The password sentinel never appears in argv, stdout, stderr, or ListingMock notes after a successful run with `--password-stdin`. | Unit test |
| FR-040-AC-5 | `--show-generated` emits the generated value to stderr exactly once; without it the value never leaks. | Unit test |
| FR-040-AC-6 | `kubectlRaw` is the only outbound network surface (no `fetch` call). | Static / grep gate |

## Dependencies

- Upstream: identity/[FR-032](./FR-032-ghcr-creds-autoprovision.md) (accept-invite endpoint), auth/[FR-008](./FR-008-ix-core-tag-convention.md)
  (operator privilege lifecycle).
- Downstream: `apps/ix/src/commands/local/auth/accept-invite.ts`,
  `packages/local/src/commands/auth-accept-invite.tsx`,
  `packages/local/tests/auth-accept-invite.test.ts`.
