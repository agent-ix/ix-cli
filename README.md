# ix-cli

The Agent IX command-line tool (`ix`). Hosts pluggable command groups
contributed by other repos in the Agent IX ecosystem.

## Workflows

`ix workflow` is preinstalled via two cooperating plugins:

- `@agent-ix/workflow-cli-plugin` — the command surface (host).
- `@agent-ix/workflow-definitions` — the first workflow contributor,
  shipping `spec-analysis`, `coding-loop`, `project-planning`.

Third parties can ship their own workflows either as an `ix` plugin (npm
package, loaded by adding to `oclif.plugins`) or as an agent skill (a
directory with `def.yaml` + optional `scripts/invariants.js`, loaded via
`ix workflow create --path <dir>`).

For the full usage guide — authoring walkthroughs, command reference,
end-to-end example, concepts, and the `WorkflowPlugin` contract — see
the [ix-agent-skills README](../ix-agent-skills/README.md).

## Local auth

`ix local auth` manages the identity service on your local `ix-local`
cluster: admin seed, user invites, password resets, and the
operator-scoped kubeconfig that backs every subsequent admin operation.

See [`docs/auth.md`](docs/auth.md) for the full subcommand reference,
the breaking change to `auth invite`, and the recovery cookbook.

### Operator privilege lifecycle

After `ix local init` finishes seeding the admin user, **downgrade from
cluster-admin to the operator-scoped kubeconfig**:

```bash
ix local auth kubeconfig issue --output ~/.kube/ix-local.yaml
export KUBECONFIG=~/.kube/ix-local.yaml
```

This binds your shell to the `system:serviceaccount:system:ix-cli-admin`
ServiceAccount provisioned by identity FR-034. Every subsequent
`ix local auth *` operation runs under that narrow grant
(`pods/exec` on `auth/identity-*`, nothing else). Cluster-admin only
reappears for Helm upgrade or break-glass recovery.

Full lifecycle, two trust zones, and recovery matrix:
[`docs/auth.md`](docs/auth.md) and the canonical
[`auth/docs/operator-lifecycle.md`](../auth/docs/operator-lifecycle.md).
Normative reference: `auth/spec/functional/FR-008-bootstrap-invite-process.md`
§Operator Privilege Lifecycle.
