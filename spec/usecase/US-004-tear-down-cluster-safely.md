---
id: US-004
title: "Developer Tears Down the Cluster Safely"
type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **developer**, I want to run `ix local cluster down` and have the kind cluster destroyed after I confirm the action, so that I can reclaim resources without accidentally deleting the cluster by mistyping.

## Context

`ix local cluster down` names the specific cluster in the confirmation prompt ([NFR-002](../non-functional/local/NFR-002-destructive-operation-confirmation.md)), then runs `kind delete cluster --name <name>`. The command is idempotent — if the cluster does not exist, it exits cleanly. Scripts can bypass the prompt with `--yes`.

## Acceptance

- **US-004-AC-1**: Running `ix local cluster down` without `--yes` prompts the user to confirm, naming the specific cluster.
- **US-004-AC-2**: Declining or cancelling the prompt exits with code 0 and leaves the cluster intact.
- **US-004-AC-3**: Running with `--yes` skips the prompt and deletes the cluster immediately.
- **US-004-AC-4**: If the cluster does not exist, the command exits 0 with an informational message.
