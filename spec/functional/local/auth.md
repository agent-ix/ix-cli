---
id: auth
title: "ix local auth — Command Suite & Namespace Contract"
artifact_type: FR
object: command_suite
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
# [auth] `ix local auth` — Command Suite & Namespace Contract

## Source of truth

The behavior of `ix local init`, `ix local auth reset-admin`, `ix local auth invite`, `ix local auth reset-user`, and `ix local auth config` is **specified in the `auth` and `identity` repos**, not here. This document is the implementation contract for `packages/local` only — it defines:

- **Namespace constants** the CLI uses across every auth-related K8s call.
- **Per-command transport mechanism** required to satisfy the security model in auth/ ADR-004 and FR-008-CON-1.
- **Cross-references** to the upstream specs so any divergence is caught.

If anything in this file disagrees with the auth or identity specs, the auth/identity specs win. This file is updated to match, never the other way around.

| Command | Authoritative spec | Mechanism |
|---|---|---|
| `ix local init` | auth/FR-008, identity/FR-017 | `kubectl exec` only — no networked endpoint |
| `ix local auth reset-admin` | auth/FR-008, identity/FR-020 §2.3 | `kubectl exec` only — no networked endpoint |
| `ix local auth invite <email>` | auth/FR-008, identity/FR-018 | `kubectl create --raw …/services/proxy/internal/users/invite` (kubeconfig-gated API server proxy) |
| `ix local auth uninvite <email>` | auth/FR-008, identity/FR-018 §5a | `kubectl create --raw …/services/proxy/internal/users/uninvite` (kubeconfig-gated API server proxy) |
| `ix local auth reset-user <email>` | auth/FR-009, identity/FR-020 §2.2 | `kubectl create --raw …/services/proxy/internal/users/reset` (kubeconfig-gated API server proxy) |
| `ix local auth config …` | identity/FR-024 | `kubectl apply` on `ConfigMap/Secret` + rollout |

## Hard rule (security invariant)

`ix local init` and `ix local auth reset-admin` SHALL NOT be reachable via any HTTP, HTTPS, API server proxy, port, ingress, or other networked endpoint. The only acceptable trigger is `kubectl exec` against the identity pod. This invariant is non-negotiable; it derives from auth/ ADR-004 (no race window for admin claim) and FR-008-CON-1 (no admin-mutating endpoint on the network).

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
- Step 2: identity refuses with `403 cannot_reset_admin_via_api` if target is admin (FR-020-CON-5). CLI surfaces this clearly: tell the operator to use `ix local auth reset-admin` for admin recovery.
- Step 3: parse response, print `reset_url`.

### `ix local auth config …` (FR-020)

- All subcommands operate on `ConfigMap auth/identity-config` and `Secret auth/identity-secrets`, then trigger `kubectl rollout restart deployment/identity -n auth`.
- No HTTP calls to identity (the email-test subcommand currently shells into the pod via `kubectl exec` to trigger a test send — acceptable since it's not creating or modifying users).

## Helper contract

`packages/local/src/commands/auth-identity.ts` exposes exactly two helpers:

- `kubectlExecJson<T>(namespace, deployment, argv)` — for `init` and `reset-admin` only. Wraps `kubectl exec` and parses stdout as JSON.
- `kubectlRaw<T>(namespace, servicePath, method, body?)` — for `invite`, `reset-user`, and `config` reads. Wraps `kubectl create --raw` / `kubectl get --raw`.

The file SHALL NOT export `fetch`, `resolveIdentityUrl`, port-forward setup, or any other HTTP transport for identity. Static analysis (ESLint custom rule or grep in CI) verifies these are absent.

## Constraints

| ID | Constraint | Rationale | Validation |
|---|---|---|---|
| ix-cli-auth-CON-1 | `auth-init.ts` and `auth-reset-admin.ts` SHALL NOT contain `fetch`, `kubectlRaw`, `http`, `https`, or any networked transport for identity | auth/ ADR-004 / FR-008-CON-1 | grep CI gate |
| ix-cli-auth-CON-2 | `auth-secret.ts` SHALL write the `admin-bootstrap` Secret to `IX_SYSTEM_NAMESPACE`, never `IX_AUTH_NAMESPACE` or any other | Blast-radius isolation (auth/ ADR-004) | Integration test |
| ix-cli-auth-CON-3 | All auth `kubectlRaw` calls SHALL target `IX_AUTH_NAMESPACE` (where identity runs) | Namespace contract | grep / unit test |
| ix-cli-auth-CON-4 | No string-literal namespaces (`"default"`, `"auth"`, `"system"`, `"platform"`, `"apps"`, `"ix-system"`) appear in `packages/local/src/` outside the constant definitions in `config.ts` | Single source of truth | grep CI gate |
| ix-cli-auth-CON-5 | The `Deployable` registry entry for `identity`, `auth-service`, and `permission-service` SHALL declare `namespace: IX_AUTH_NAMESPACE`; helm deploys SHALL respect `deployable.namespace` | Auth services land in `auth`, not the default | Integration test |

## Acceptance criteria

| ID | Criteria | Verification |
|---|---|---|
| ix-cli-auth-AC-1 | Source review of `auth-init.ts` and `auth-reset-admin.ts` finds no HTTP transport (grep `fetch\|http://\|https://\|--raw` returns no matches in the relevant code paths) | Source inspection |
| ix-cli-auth-AC-2 | After `ix up`, `kubectl get ns system auth platform apps` shows all four namespaces present | Integration test |
| ix-cli-auth-AC-3 | After `ix local init`, the bootstrap Secret exists at `system/admin-bootstrap`, NOT at `auth/admin-bootstrap` | Integration test |
| ix-cli-auth-AC-4 | After `ix up`, `kubectl get deployment identity -n auth` returns the deployment | Integration test |
| ix-cli-auth-AC-5 | `ix local auth reset-user <admin-email>` surfaces a clear "use reset-admin" message when identity refuses with `cannot_reset_admin_via_api` | Integration test |
| ix-cli-auth-AC-6 | Grep `packages/local/src` for namespace literals returns zero matches outside `config.ts` | CI gate |

## Dependencies

- Upstream: auth/ADR-004, auth/FR-008, auth/FR-009, auth/NFR-004, identity/FR-017, identity/FR-018, identity/FR-020, identity/FR-025.
- Downstream: `packages/local/src/commands/auth-{init,reset-admin,invite,reset-user,secret,config,identity}.ts`, `packages/local/src/config.ts`, `packages/local/src/discovery.ts`, `packages/local/src/commands/up-{image,source}.ts`, `packages/local/src/index.ts`.

## Out of scope (tracked separately)

- Identity-side: shipping `python -m identity.cli init-admin` / `reset-admin`; removing `POST /internal/admin/seed`; admin-role refusal on `POST /internal/users/reset`.
- Per-app namespace split (replacing single `apps` namespace).
- NetworkPolicies between tiers.
- Eventual rename of `platform` → `ix` (single-constant change).
