# Auth — local identity administration

`ix local auth` is the operator-facing surface for the identity service
running on your local `ix-local` cluster. It covers the admin-user
lifecycle (seed, invite, reset, recover) and, after `ix local init`, the
one-way downgrade from cluster-admin to an operator-scoped kubeconfig.

For the design rationale and the full lifecycle, see
[`auth/docs/operator-lifecycle.md`](../../auth/docs/operator-lifecycle.md)
(canonical) and `auth/spec/functional/FR-008-bootstrap-invite-process.md`
(normative).

## TL;DR

Fresh cluster, end-to-end:

```bash
ix local up && ix local init
# → cluster up, identity admin seeded
ix local auth kubeconfig issue --output ~/.kube/ix-local.yaml
export KUBECONFIG=~/.kube/ix-local.yaml
# → now operating as system:serviceaccount:system:ix-cli-admin
ix local auth invite alice@example.com --tenant <tenant-id>
# → prints invite_url; admin shares out-of-band, invitee opens in browser
```

After the headless-acceptance work (FR-040..FR-043) lands the canonical
fresh-cluster flow becomes:

```bash
ix local up && ix local init
ix local auth kubeconfig issue --output ~/.kube/ix-local.yaml
export KUBECONFIG=~/.kube/ix-local.yaml
ix local auth create-user testbot@agent-ix.local --tenant <tenant-id>
# → user provisioned + saved to agent-browser vault if installed
```

`create-user` (FR-043) is **coming soon**. Until it ships, use the
working commands documented in [Subcommand reference](#subcommand-reference)
below.

## Operator privilege lifecycle

`ix local auth` is the steady-state interface for the operator-scoped
trust zone. Four phases:

1. **Install** — `ix local up` installs the identity Helm chart, which
   ships the FR-034 RBAC manifests (`ServiceAccount system/ix-cli-admin`,
   pre-created token Secret, narrow `Role auth/identity-admin-exec`,
   matching RoleBinding). Run under your cluster-admin kubeconfig.
2. **Seed** — `ix local init` execs `identity.cli init-admin` in-pod and
   writes the temp credential to `system/admin-bootstrap`. Still
   cluster-admin.
3. **Downgrade** — `ix local auth kubeconfig issue` mints an
   operator-scoped kubeconfig bound to the `ix-cli-admin` ServiceAccount.
   Switch to it; archive or destroy the cluster-admin kubeconfig.
4. **Steady state** — every subsequent `ix local auth *` runs under the
   scoped kubeconfig. Cluster-admin only reappears for Helm upgrade,
   namespace surgery, or break-glass recovery.

The full lifecycle, the two trust zones, and the sequence diagram are
documented in
[`auth/docs/operator-lifecycle.md`](../../auth/docs/operator-lifecycle.md).
`auth/spec/functional/FR-008-bootstrap-invite-process.md` is the
normative reference.

## Breaking change: `auth invite` now requires `--tenant <id>`

Per identity FR-018-CON-4, an invited user **MUST** be bound to a
default tenant in the same transaction as user creation. The CLI now
requires the operator to supply that tenant:

```bash
# Before (no longer works):
ix local auth invite alice@example.com

# After:
ix local auth invite alice@example.com --tenant <tenant-uuid>
```

Existing scripts that call `ix local auth invite` without `--tenant`
will receive a 400 `tenant_required` error after upgrade.

**Migration.** Discover the tenant id you want the user to land in:

```bash
ix local auth tenant list <admin-email>     # coming soon (FR-042)
# Until FR-042 ships, query identity directly:
kubectl exec -n auth deploy/identity -- \
  python -m identity.cli list-tenants --output json
```

Then add `--tenant <uuid>` to every invite call.

## Subcommand reference

### Shipped today

#### `ix local auth kubeconfig issue` (FR-044)

Emits the operator-scoped kubeconfig — Phase 3 of the lifecycle.

```bash
ix local auth kubeconfig issue --output ~/.kube/ix-local.yaml
export KUBECONFIG=~/.kube/ix-local.yaml
```

Flags:

| Flag | Default | Description |
|---|---|---|
| `--output <path>` | required | Where to write the new kubeconfig. Parent dir must exist. Written `chmod 600`, atomic. |
| `--context-name <name>` | `ix-local` | Context name and `current-context`. |
| `--force` | `false` | Overwrite an existing file at `--output`. |

Requires cluster-admin on the active kubeconfig (you need `get` on
`secrets/ix-cli-admin-token` in `system`, which the scoped SA does not
itself hold).

#### `ix local auth invite <email> --tenant <id>` (FR-017)

Invites a new user. **Breaking:** `--tenant` is now required (see
above). Prints the `invite_url`; the admin shares it out-of-band, the
invitee opens it in cloud-manager-ui and sets a password.

#### `ix local auth uninvite <email>`

Revokes a pending invite token. No effect on already-accepted users.

#### `ix local auth reset-user <email>`

Admin password reset for a non-admin user. Identity refuses this
endpoint for admin targets (FR-008-CON-7) — for admin recovery use
`reset-admin` instead.

#### `ix local auth reset-admin`

Recovers the lost admin password. Execs `identity.cli reset-admin`
in-pod and overwrites `Secret system/admin-bootstrap` with a fresh
single-use temp credential. The scoped SA holds enough RBAC to run
this — cluster-admin is not required.

#### `ix local auth config registration {set,get}`

Sets/reads `registration.mode` — `closed`, `invite_only`, `admin_approved`,
or `self_service`. Drives identity's gate on `POST /users/register`.

### Coming soon

| Command | FR | One-liner |
|---|---|---|
| `ix local auth accept-invite <token> --password <pw>` | FR-040 | Headless invite acceptance — collapses the browser-rendered `invite → rotate` round-trip into one CLI call. Calls identity FR-032. |
| `ix local auth rotate-password <email>` | FR-041 | Operator-triggered password rotation for a non-admin user. |
| `ix local auth tenant add` | FR-042 | Add a tenant membership for an existing user (identity FR-033 POST). |
| `ix local auth tenant list <email>` | FR-042 | List a user's tenant memberships (identity FR-033 GET). |
| `ix local auth tenant set-default <email> --tenant <id>` | FR-042 | Re-pin a user's default tenant (identity FR-033 PATCH). |
| `ix local auth tenant remove <email> --tenant <id>` | FR-042 | Soft-delete a membership (identity FR-033 DELETE). |
| `ix local auth create-user <email> --tenant <id>` | FR-043 | Orchestrator: invite + headless-accept + tenant-assign in one call. Optionally saves the credential to the agent-browser vault. |
| `ix local auth kubeconfig rotate` | FR-045 | Delete + recreate the SA token Secret. Revokes every outstanding operator-scoped kubeconfig. Cluster-admin operation. |

## Recovery cookbook

Operator-facing summary of `auth/docs/operator-lifecycle.md` §Recovery.

### Lost: operator-scoped kubeconfig (`~/.kube/ix-local.yaml`)

Always recoverable while cluster-admin is recoverable. On any machine
with the cluster-admin kubeconfig:

```bash
ix local auth kubeconfig issue --output ~/.kube/ix-local.yaml
export KUBECONFIG=~/.kube/ix-local.yaml
```

The SA Secret persists across pod restarts and across operator-laptop
loss. Outstanding scoped kubeconfigs on other machines keep working.

### Lost: cluster-admin kubeconfig

Per-provider:

| Provider | Recovery |
|---|---|
| kind | `kind get kubeconfig --name <cluster>` |
| EKS | `aws eks update-kubeconfig --name <cluster>` |
| GKE | `gcloud container clusters get-credentials <cluster>` |
| On-prem | ssh control-plane, copy `/etc/kubernetes/admin.conf` |

If provider-level recovery is also lost, the cluster is unrecoverable —
that's a Kubernetes-level disaster, not specific to this design.

### Lost: identity admin password

`ix local auth reset-admin`. Works under the operator-scoped
kubeconfig — cluster-admin not required.

```bash
ix local auth reset-admin
kubectl get secret -n system admin-bootstrap -o jsonpath='{.data.password}' | base64 -d
```

### Suspected scoped-kubeconfig leak (deliberate revocation)

```bash
# Switch to cluster-admin first (kubeconfig rotate requires delete on the Secret)
export KUBECONFIG=~/.kube/ix-cluster-admin.yaml
ix local auth kubeconfig rotate           # FR-045, coming soon
# Manual fallback until FR-045 ships:
kubectl delete secret -n system ix-cli-admin-token
# SA controller recreates the Secret with a fresh token within seconds
# Re-issue the scoped kubeconfig
ix local auth kubeconfig issue --output ~/.kube/ix-local.yaml --force
export KUBECONFIG=~/.kube/ix-local.yaml
```

All outstanding scoped kubeconfigs are invalidated by the token rotate.

## See also

- [`auth/docs/operator-lifecycle.md`](../../auth/docs/operator-lifecycle.md) —
  canonical lifecycle write-up.
- [`identity/docs/admin-rbac.md`](../../identity/docs/admin-rbac.md) —
  RBAC manifests shipped by the identity chart.
- [`identity/docs/invite-flows.md`](../../identity/docs/invite-flows.md) —
  browser vs headless invite acceptance.
- Spec: `spec/functional/local/auth.md` — command-suite contract.
- Spec: `spec/functional/local/FR-044-auth-kubeconfig-issue.md` — this
  command's normative reference.
