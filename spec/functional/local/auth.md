---
id: FR-046
title: "ix local auth — Command Suite & Namespace Contract"
type: FR
relationships:
  - target: "ix://agent-ix/auth/ADR-004"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/auth/FR-008"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/auth/FR-009"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/auth/NFR-004"
    type: "constrained_by"
    cardinality: "1:1"
  - target: "ix://agent-ix/identity/FR-017"
    type: "calls"
    cardinality: "1:1"
  - target: "ix://agent-ix/identity/FR-018"
    type: "calls"
    cardinality: "1:1"
  - target: "ix://agent-ix/identity/FR-020"
    type: "calls"
    cardinality: "1:1"
  - target: "ix://agent-ix/identity/FR-025"
    type: "constrained_by"
    cardinality: "1:1"
---
# [FR-046] `ix local auth` — Command Suite & Namespace Contract

## Description

`packages/local` SHALL implement the `ix local auth` command suite (init,
reset-admin, invite, uninvite, reset-user, config, kubeconfig) and the
four-namespace contract using the transport mechanism mandated for each command
by the upstream `auth`/`identity` specs. This document is the implementation
contract for `packages/local`; the authoritative command behavior is owned by
the `auth` and `identity` repos.

## Source of truth

The behavior of `ix local init`, `ix local auth reset-admin`, `ix local auth invite`, `ix local auth reset-user`, and `ix local auth config` is **specified in the `auth` and `identity` repos**, not here. This document is the implementation contract for `packages/local` only — it defines:

- **Namespace constants** the CLI uses across every auth-related K8s call.
- **Per-command transport mechanism** required to satisfy the security model in auth/ ADR-004 and [FR-008-CON-1](./FR-008-ix-core-tag-convention.md).
- **Cross-references** to the upstream specs so any divergence is caught.

If anything in this file disagrees with the auth or identity specs, the auth/identity specs win. This file is updated to match, never the other way around.

| Command | Authoritative spec | Mechanism |
|---|---|---|
| `ix local init` | auth/[FR-008](./FR-008-ix-core-tag-convention.md), identity/FR-017 | `kubectl exec` only — no networked endpoint |
| `ix local auth reset-admin` | auth/[FR-008](./FR-008-ix-core-tag-convention.md), identity/[FR-020](../core/FR-020-core-plugin-schema.md) §2.3 | `kubectl exec` only — no networked endpoint |
| `ix local auth invite <email>` | auth/[FR-008](./FR-008-ix-core-tag-convention.md), identity/FR-018 | `kubectl create --raw …/services/proxy/internal/users/invite` (kubeconfig-gated API server proxy) |
| `ix local auth uninvite <email>` | auth/[FR-008](./FR-008-ix-core-tag-convention.md), identity/FR-018 §5a | `kubectl create --raw …/services/proxy/internal/users/uninvite` (kubeconfig-gated API server proxy) |
| `ix local auth reset-user <email>` | auth/[FR-009](./FR-009-cluster-default-configuration.md), identity/[FR-020](../core/FR-020-core-plugin-schema.md) §2.2 | `kubectl create --raw …/services/proxy/internal/users/reset` (kubeconfig-gated API server proxy) |
| `ix local auth config …` | identity/FR-024 | `kubectl apply` on `ConfigMap/Secret` + rollout |
| `ix local auth kubeconfig issue` | ix-cli/[FR-044](./FR-044-auth-kubeconfig-issue.md), identity/[FR-034](./FR-034-refresh-changed-output.md), identity/[FR-035](./FR-035-halt-all-image-mode.md) | `kubectl get secret -n system ix-cli-admin-token` + `kubectl config view --raw --minify` + local atomic file write (mode 0600). No identity HTTP call. |
| `ix local auth kubeconfig rotate` | ix-cli/[FR-045](./FR-045-auth-kubeconfig-rotate.md), identity/[FR-034](./FR-034-refresh-changed-output.md) | `kubectl delete secret -n system ix-cli-admin-token` + poll for SA-token controller recreate. No identity HTTP call. |

> **Note — Operator Privilege Lifecycle.** `kubeconfig issue` and
> `kubeconfig rotate` implement Phase 3 and the revocation primitive of
> the auth umbrella's **Operator Privilege Lifecycle** (auth/[FR-008](./FR-008-ix-core-tag-convention.md)).
> See that section and its recovery matrix for the end-to-end flow:
> kind cluster-admin → `ix local up` → `ix local init` → `ix local auth
> kubeconfig issue` → operator runs as scoped SA from then on. Token
> revocation, lost-kubeconfig recovery, and lost-cluster-admin recovery
> are all enumerated there; this file documents only the per-command
> mechanism the CLI uses.

## Hard rule (security invariant)

`ix local init` and `ix local auth reset-admin` SHALL NOT be reachable via any HTTP, HTTPS, API server proxy, port, ingress, or other networked endpoint. The only acceptable trigger is `kubectl exec` against the identity pod. This invariant is non-negotiable; it derives from auth/ ADR-004 (no race window for admin claim) and [FR-008-CON-1](./FR-008-ix-core-tag-convention.md) (no admin-mutating endpoint on the network).

Any networked endpoint capable of creating or resetting an admin is a security vulnerability — even when authenticated by kubeconfig, even when restricted by NetworkPolicy. The mechanism difference between admin operations (exec) and non-admin operations (kubeconfig-gated API proxy) is intentional: it tracks the privilege level of the operation, not the identity of the caller.

## Namespace contract

`packages/local/src/config.ts` exports four namespace constants. Every kubectl/helm invocation in `packages/local/src/` SHALL use one of them; no string-literal namespaces (`"default"`, `"auth"`, `"system"`, etc.) appear elsewhere in the codebase.

| Constant | Value | Holds | Notes |
|---|---|---|---|
| `IX_SYSTEM_NAMESPACE` | `"system"` | `admin-bootstrap` Secret, ClusterRoles, NetworkPolicies. No pods. | Operator-only RBAC. Bootstrap Secret isolated here so a compromised auth-namespace pod has no path to read it. |
| `IX_AUTH_NAMESPACE` | `"auth"` | identity, auth-service, permission-service. | Trust root. NetworkPolicy SHALL restrict `/internal/*` to in-cluster callers (the K8s API server proxy counts as in-cluster). |
| `IX_PLATFORM_NAMESPACE` | `"platform"` | Shared infrastructure: npm-proxy, pypi-proxy, postgres, redis, rabbitmq, vault, k8s-gateway. | Default for charts that do not declare their own namespace via `Deployable.namespace`. |
| `IX_APPS_NAMESPACE` | `"apps"` | Application services: catalog, scenarios, deploy-worker, review-*, workspace-*, orchestrator, etc. | Single namespace for now; per-app split is a future iteration. |

Cross-namespace traffic note: app services in `apps` reach `auth-service` and `identity` via each app's own `/g/` proxy (login, profile flows). This is normal app-to-platform-service traffic, not a security boundary the namespace split tries to close.

## Command implementation contract

### `ix local init` (FR-015)

- Trigger: operator runs `ix local init`.
- Step 1: `kubectl get secret admin-bootstrap -n system --ignore-not-found` (idempotency check). If present and not expired, print details and exit 0.
- Step 2: `kubectl exec -n auth deployment/identity -- python -m identity.cli init-admin --output json`.
- Step 3: parse stdout JSON `{user_id, password, expires_at, login_url}`.
- Step 4: `kubectl apply` Secret `system/admin-bootstrap` with the captured fields.
- Step 5: print credentials to stdout (one-shot, never logged).
- Mechanism MUST NOT include any HTTP fetch, port-forward, or `kubectl create --raw` to identity.

### `ix local auth reset-admin` (FR-016)

- Trigger: operator runs `ix local auth reset-admin`.
- Step 1: `kubectl exec -n auth deployment/identity -- python -m identity.cli reset-admin --output json` (optionally `--email <email>` / `--username <username>` to disambiguate when multiple admins exist).
- Step 2: parse stdout JSON, write Secret `system/admin-bootstrap` (overwrite).
- Step 3: print credentials.
- Mechanism MUST NOT include any HTTP fetch, port-forward, or `kubectl create --raw` to identity.

### `ix local auth invite <email>` (FR-017)

- Trigger: operator runs `ix local auth invite alice@example.com [--username] [--display-name] [--groups] [--ttl]`.
- Step 1 (pre-flight): `kubectl get --raw /api/v1/namespaces/auth/services/http:identity:80/proxy/config/public` to read `registration.mode`. Refuse if `closed`.
- Step 2: `kubectl create --raw /api/v1/namespaces/auth/services/http:identity:80/proxy/internal/users/invite -f -` with body `{email, username?, display_name?, groups?, ttl_hours?}`.
- Step 3: parse response. On HTTP 201 the user was created; on HTTP 200 an existing **unclaimed** invite was reissued with a fresh token (identity supersedes the prior one). Either way, print `invite_url` to stdout.
- Identity returns 409 only when the target email belongs to a **claimed** account (`password_hash` set). The CLI surfaces that as: "Account already claimed; use `ix local auth reset-user`."
- Default username is the full email address (not the local-part) — this prevents collisions when two distinct emails share a local-part.

### `ix local auth uninvite <email>` (FR-017a)

- Trigger: operator runs `ix local auth uninvite alice@example.com`.
- Step 1: `kubectl create --raw /api/v1/namespaces/auth/services/http:identity:80/proxy/internal/users/uninvite -f -` with body `{email}`.
- Step 2: parse response. On HTTP 200 print `revoked` count.
- Identity returns 404 when no user matches; 409 `account_claimed` when the user has already set a password (use `reset-user` for those).
- The user row is **not deleted** — only outstanding invite tokens are superseded and `temp_credential_*` fields are cleared. Re-running `invite` for the same email after `uninvite` is allowed and goes through the reissue path.

### `ix local auth reset-user <email>` (FR-018)

- Trigger: operator runs `ix local auth reset-user alice@example.com [--ttl]`.
- Step 1: `kubectl create --raw /api/v1/namespaces/auth/services/http:identity:80/proxy/internal/users/reset -f -` with body `{email_or_username, ttl_hours?}`.
- Step 2: identity refuses with `403 cannot_reset_admin_via_api` if target is admin ([FR-020-CON-5](../core/FR-020-core-plugin-schema.md)). CLI surfaces this clearly: tell the operator to use `ix local auth reset-admin` for admin recovery.
- Step 3: parse response, print `reset_url`.

### `ix local auth config …` ([FR-020](../core/FR-020-core-plugin-schema.md))

- All subcommands operate on `ConfigMap auth/identity-config` and `Secret auth/identity-secrets`, then trigger `kubectl rollout restart deployment/identity -n auth`.
- No HTTP calls to identity (the email-test subcommand currently shells into the pod via `kubectl exec` to trigger a test send — acceptable since it's not creating or modifying users).

## Helper contract

`packages/local/src/commands/auth-identity.ts` exposes exactly two helpers:

- `kubectlExecJson<T>(namespace, deployment, argv)` — for `init` and `reset-admin` only. Wraps `kubectl exec` and parses stdout as JSON.
- `kubectlRaw<T>(namespace, servicePath, method, body?)` — for `invite`, `reset-user`, and `config` reads. Wraps `kubectl create --raw` / `kubectl get --raw`.

The file SHALL NOT export `fetch`, `resolveIdentityUrl`, port-forward setup, or any other HTTP transport for identity. Static analysis (ESLint custom rule or grep in CI) verifies these are absent.

## Constraints

| ID | Constraint | Type | Validation |
|---|---|---|---|
| FR-046-CON-1 | `auth-init.ts` and `auth-reset-admin.ts` SHALL NOT contain `fetch`, `kubectlRaw`, `http`, `https`, or any networked transport for identity | Security | grep CI gate |
| FR-046-CON-2 | `auth-secret.ts` SHALL write the `admin-bootstrap` Secret to `IX_SYSTEM_NAMESPACE`, never `IX_AUTH_NAMESPACE` or any other | Security | Integration test |
| FR-046-CON-3 | All auth `kubectlRaw` calls SHALL target `IX_AUTH_NAMESPACE` (where identity runs) | Security | grep / unit test |
| FR-046-CON-4 | No string-literal namespaces (`"default"`, `"auth"`, `"system"`, `"platform"`, `"apps"`, `"ix-system"`) appear in `packages/local/src/` outside the constant definitions in `config.ts` | Maintainability | grep CI gate |
| FR-046-CON-5 | The `Deployable` registry entry for `identity`, `auth-service`, and `permission-service` SHALL declare `namespace: IX_AUTH_NAMESPACE`; helm deploys SHALL respect `deployable.namespace` | Correctness | Integration test |

Rationale: FR-046-CON-1 derives from auth/ ADR-004 and [FR-008-CON-1](./FR-008-ix-core-tag-convention.md) (no
admin-mutating network endpoint). FR-046-CON-2 enforces blast-radius isolation
(auth/ ADR-004). FR-046-CON-3 follows the namespace contract above.
FR-046-CON-4 keeps the namespace constants a single source of truth.
FR-046-CON-5 ensures auth services land in the `auth` namespace, not the
default.

## Acceptance criteria

| ID | Criteria | Verification |
|---|---|---|
| FR-046-AC-1 | Source review of `auth-init.ts` and `auth-reset-admin.ts` finds no HTTP transport (grep `fetch\|http://\|https://\|--raw` returns no matches in the relevant code paths) | Source inspection |
| FR-046-AC-2 | After `ix up`, `kubectl get ns system auth platform apps` shows all four namespaces present | Integration test |
| FR-046-AC-3 | After `ix local init`, the bootstrap Secret exists at `system/admin-bootstrap`, NOT at `auth/admin-bootstrap` | Integration test |
| FR-046-AC-4 | After `ix up`, `kubectl get deployment identity -n auth` returns the deployment | Integration test |
| FR-046-AC-5 | `ix local auth reset-user <admin-email>` surfaces a clear "use reset-admin" message when identity refuses with `cannot_reset_admin_via_api` | Integration test |
| FR-046-AC-6 | Grep `packages/local/src` for namespace literals returns zero matches outside `config.ts` | CI gate |

## Dependencies

- Upstream: auth/ADR-004, auth/[FR-008](./FR-008-ix-core-tag-convention.md), auth/[FR-009](./FR-009-cluster-default-configuration.md), auth/NFR-004, identity/FR-017, identity/FR-018, identity/[FR-020](../core/FR-020-core-plugin-schema.md), identity/FR-025.
- Downstream: `packages/local/src/commands/auth-{init,reset-admin,invite,reset-user,secret,config,identity}.ts`, `packages/local/src/config.ts`, `packages/local/src/discovery.ts`, `packages/local/src/commands/up-{image,source}.ts`, `packages/local/src/index.ts`.

## Out of scope (tracked separately)

- Identity-side: shipping `python -m identity.cli init-admin` / `reset-admin`; removing `POST /internal/admin/seed`; admin-role refusal on `POST /internal/users/reset`.
- Per-app namespace split (replacing single `apps` namespace).
- NetworkPolicies between tiers.
- Eventual rename of `platform` → `ix` (single-constant change).
