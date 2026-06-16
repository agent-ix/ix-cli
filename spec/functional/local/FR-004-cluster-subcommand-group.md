---
id: FR-004
title: "ix local cluster Subcommand Group (up / down / status)"
type: FR
object: command-group
relationships:
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-004"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-005"
    type: "implements"
    cardinality: "1:1"
---

## Behavior

`ix local cluster` registers three oclif commands under the `local cluster` topic:

| Subcommand | Description |
|---|---|
| `ix local cluster up` | Bootstrap cluster and deploy default service set |
| `ix local cluster down` | Destroy cluster (confirmation required) |
| `ix local cluster status` | Read-only node and pod health summary |

The oclif topic `"local cluster"` is registered in `apps/ix/package.json` under `oclif.topics`. Each command is registered as a build entry in `apps/ix/vite.config.ts`.

## Acceptance

- **FR-004-AC-1**: `ix local cluster --help` lists `up`, `down`, and `status` subcommands.
- **FR-004-AC-2**: `ix local cluster up --help` shows `--reconfigure-credentials`, `--include-tag`, and `--exclude-tag` flags.
- **FR-004-AC-3**: `ix local cluster down --help` shows the `--yes` flag.
- **FR-004-AC-4**: Each command delegates to the corresponding runner in `@agent-ix/ix-cli-local` and calls `this.exit(1)` on unhandled errors.
