---
id: FR-007
title: "Read-Only Cluster Health Summary (Nodes + Pods)"
type: FR
object: process
relationships:
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-005"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-004"
    type: "implements"
    cardinality: "1:1"
---

## Description

`runClusterStatus()` renders cluster health using two kubectl queries:

**Node table** — `kubectl get nodes -o json` → cli-table3 table with columns: NAME, ROLE, STATUS, AGE. ROLE is `control-plane` (has `NoSchedule` taint) or `worker`. STATUS is `Ready` or `NotReady` (colorised via picocolors). AGE is computed from `metadata.creationTimestamp`.

**Pod table** (conditional) — `kubectl get pods -A -o json`. Pods with phase `Running` or `Succeeded` are healthy. If unhealthy pods exist, a second table is rendered: NAMESPACE, NAME, PHASE (colorised), RESTARTS. If all pods are healthy, `outroSuccess("All pods healthy.")` is shown and no pod table is rendered.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-007-AC-1 | Node table is always rendered with NAME, ROLE, STATUS, AGE columns. | Test |
| FR-007-AC-2 | STATUS column shows `Ready` for nodes with Ready condition True. | Test |
| FR-007-AC-3 | ROLE column shows `control-plane` for nodes with a `NoSchedule` taint. | Test |
| FR-007-AC-4 | When all pods are in Running or Succeeded phase, only `outroSuccess("All pods healthy.")` is shown. | Test |
| FR-007-AC-5 | Unhealthy pods are listed in a second table with NAMESPACE, NAME, PHASE, RESTARTS columns. | Test |
| FR-007-AC-6 | Failure of `kubectl get nodes` calls `outroError` and throws a descriptive error. | Test |
| FR-007-AC-7 | No cluster state is modified. | Test |

- **FR-007-AC-1**: Node table is always rendered with NAME, ROLE, STATUS, AGE columns.
- **FR-007-AC-2**: STATUS column shows `Ready` for nodes with Ready condition True.
- **FR-007-AC-3**: ROLE column shows `control-plane` for nodes with a `NoSchedule` taint.
- **FR-007-AC-4**: When all pods are in Running or Succeeded phase, only `outroSuccess("All pods healthy.")` is shown.
- **FR-007-AC-5**: Unhealthy pods are listed in a second table with NAMESPACE, NAME, PHASE, RESTARTS columns.
- **FR-007-AC-6**: Failure of `kubectl get nodes` calls `outroError` and throws a descriptive error.
- **FR-007-AC-7**: No cluster state is modified.

## Workflow

```mermaid
sequenceDiagram
    actor User
    participant CLI as ix local cluster status
    participant Status as runClusterStatus
    participant Kubectl as kubectl
    participant NodeTable as cli-table3 (nodes)
    participant PodTable as cli-table3 (unhealthy)
    participant UI as Listing / outroSuccess / outroError

    User->>CLI: ix local cluster status
    CLI->>Status: runClusterStatus()
    Status->>Kubectl: kubectl get nodes -o json
    alt kubectl error
        Status->>UI: Listing(failed, "Cannot reach cluster")
        Status-->>User: throw "kubectl get nodes failed"
    end
    Kubectl-->>Status: nodes JSON
    Status->>NodeTable: rows(NAME, ROLE, STATUS, AGE) coloured via picocolors
    NodeTable-->>User: print
    Status->>Kubectl: kubectl get pods -A -o json
    Kubectl-->>Status: pods JSON
    Status->>Status: filter where phase ∉ {Running, Succeeded}
    alt all healthy
        Status->>UI: outroSuccess("All pods healthy.")
    else unhealthy pods present
        Status->>PodTable: rows(NAMESPACE, NAME, PHASE, RESTARTS)
        PodTable-->>User: print
    end
    Status-->>User: return (no cluster state mutated)
```

## Dependencies

- **implements**: ix-cli/spec/usecase/US-005
- **implements**: ix-cli/spec/functional/local/FR-004
