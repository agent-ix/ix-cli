---
id: FR-042
title: "ix local auth tenant — Tenant membership CRUD"
artifact_type: FR
object: cli_command_suite
relationships:
  - target: "ix://agent-ix/identity/FR-033"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/identity/FR-036"
    type: "consumes"
    cardinality: "1:1"
  - target: "ix://agent-ix/auth/FR-008"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/auth"
    type: "extends"
    cardinality: "1:1"
---
# [FR-042] `ix local auth tenant` — Tenant membership CRUD

## Description

Four sibling subcommands wrap identity's FR-033 `/admin/users/{user_id}/memberships`
endpoints so operators can manage tenant membership from the CLI. Every
verb first resolves email → user_id via identity FR-036
(`POST /internal/users/lookup`), then issues the relevant FR-033 HTTP verb.

| Subcommand | Verb | Path |
|---|---|---|
| (resolve) | POST | `/internal/users/lookup` (FR-036) |
| `list <email>` | GET | `/admin/users/{user_id}/memberships` |
| `add <email> --tenant <id> --role <r> [--is-default]` | POST | `/admin/users/{user_id}/memberships` |
| `set-default <email> --tenant <id>` | PATCH | `/admin/users/{user_id}/memberships/{tenant_id}` |
| `remove <email> --tenant <id>` | DELETE | `/admin/users/{user_id}/memberships/{tenant_id}` |

### Mechanism

| Call | Path | Runtime gate |
|---|---|---|
| email → user_id resolution | `POST /internal/users/lookup` (identity FR-036) | K8s RBAC `pods/exec` on `auth/identity*` (FR-034) — in-pod-exec-gated |
| Membership CRUD | `/admin/users/{user_id}/memberships*` (identity FR-033) | K8s RBAC `pods/exec` on `auth/identity*` (FR-034) — in-pod-exec-gated |

Both calls go through `kubectlRaw`, the in-pod-exec shim. The earlier design
routed resolution through identity's JWT-gated `GET /admin/users?q=<email>`
admin search, which would have required a separate auth mechanism (a valid
admin JWT) the CLI does not hold. Routing both through FR-036 + FR-033
keeps the entire command suite on a single runtime gate (FR-034 RBAC)
consistent with FR-033-CON-6 and FR-036-CON-4.

## Constraints

- **FR-042-CON-1**: All calls go through `kubectlRaw` (kubeconfig-gated).
- **FR-042-CON-2**: Operator-facing errors translate identity envelope
  codes into human-readable messages (`would_violate_default_invariant`,
  `suspended_cannot_set_default`, `cross_tenant_admin_forbidden`,
  `membership_exists`, `membership_not_found`).

## Acceptance Criteria

| ID | Criteria | Verification |
|---|---|---|
| FR-042-AC-1 | `list` resolves the user then GETs memberships and renders one Item per row. | Unit test |
| FR-042-AC-2 | `list` reports "no user matched" when the FR-036 lookup returns 404 `user_not_found`. | Unit test |
| FR-042-AC-9 | The resolver issues `POST /internal/users/lookup` (FR-036), not `GET /admin/users?q=`. Input containing `@` is sent as `{email}`; otherwise as `{username}`. | Unit test |
| FR-042-AC-3 | `add` POSTs `{tenant_id, role, is_default}` and renders the response. | Unit test |
| FR-042-AC-4 | `add` 409 `membership_exists` surfaces "already exists". | Unit test |
| FR-042-AC-5 | `add` 403 `cross_tenant_admin_forbidden` surfaces an admin-authorization message. | Unit test |
| FR-042-AC-6 | `set-default` PATCHes `{is_default: true}` and renders the result. | Unit test |
| FR-042-AC-7 | `set-default` 400 `suspended_cannot_set_default` surfaces the constraint. | Unit test |
| FR-042-AC-8 | `remove` DELETEs and 409 `would_violate_default_invariant` is surfaced as a default-invariant error. | Unit test |

## Dependencies

- Upstream: identity/FR-033.
- Downstream: `apps/ix/src/commands/local/auth/tenant/{list,add,set-default,remove}.ts`,
  `packages/local/src/commands/auth-tenant.tsx`,
  `packages/local/tests/auth-tenant.test.ts`.
