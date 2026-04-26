---
id: FR-006
title: "Cluster Teardown with Confirmation Guard"
artifact_type: FR
object: process
relationships:
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-004"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-004"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/non-functional/local/NFR-002"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

`runClusterDown(config, opts)` tears down the kind cluster:

1. If `opts.yes` is false, prompts the user via `@clack/prompts` confirm with a message naming the specific cluster (NFR-002-AC-1). If declined or cancelled, calls `outroSuccess("Cancelled. Cluster not deleted.")` and returns.
2. Calls `kind get clusters` and checks whether the target cluster is listed.
3. If absent, calls `outroSuccess("Cluster '…' does not exist. Nothing to delete.")` and returns.
4. Calls `kind delete cluster --name <name>` with `stdio: "inherit"`.
5. On success: `outroSuccess`. On failure: `outroError` + rethrows.

## Acceptance

- **FR-006-AC-1**: Without `--yes`, a `@clack/prompts` confirm prompt is shown before any destructive action.
- **FR-006-AC-2**: Prompt decline or cancel exits 0 without calling `kind delete cluster`.
- **FR-006-AC-3**: The command is idempotent — absent cluster exits 0 with an informational message.
- **FR-006-AC-4**: `kind delete cluster` is the only process spawned for destruction (no helm uninstall).
- **FR-006-AC-5**: Failure of `kind delete cluster` propagates the error after calling `outroError`.
