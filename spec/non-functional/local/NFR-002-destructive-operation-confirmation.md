---
id: NFR-002
title: "Destructive Cluster Operations Require Explicit Confirmation"
type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-006"
    type: "constrains"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-004"
    type: "constrains"
    cardinality: "1:1"
---

## Statement

Any command that irreversibly destroys cluster state SHALL prompt the user for confirmation before proceeding, and the confirmation message SHALL name the specific cluster to be destroyed. Commands that accept a `--yes` flag may bypass the prompt in automated contexts.

## Rationale

Cluster teardown destroys all PVC data, deployed releases, and secret state. A misfire in an interactive shell (e.g. running `ix local cluster down` instead of `ix local cluster status`) would require full cluster re-initialisation. Naming the cluster in the prompt forces the user to consciously read what will be deleted.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Destructive cluster commands gated by a name-naming confirmation prompt | 100% | 100% | Demonstration |
| Declined/cancelled confirmations that proceed with destruction | 0 | 0 | Test |

## Verification

The cluster-teardown command tests drive `ix local cluster down` with and
without `--yes`, asserting the prompt names the target cluster and that a
declined or cancelled prompt exits 0 with no destructive call. CI fails on any
regression.

## Acceptance Criteria

- **NFR-002-AC-1**: The confirmation prompt MUST include the literal cluster name (e.g. `'ix'`) in its message text.
- **NFR-002-AC-2**: Declined or cancelled confirmation MUST exit 0 with no destructive action taken.
- **NFR-002-AC-3**: `--yes` flag bypasses the prompt; the destructive action proceeds immediately.
- **NFR-002-AC-4**: No other cluster teardown command (future additions) may skip this constraint without an explicit NFR exemption.
