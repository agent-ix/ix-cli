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
