---
id: StR-003
title: "Cluster Lifecycle Managed by a Single ix Command"
artifact_type: StR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-001"
    type: "extends"
    cardinality: "1:1"
---

## Stakeholder Need

Platform engineers and developers need to bring up, tear down, and inspect the local kind cluster without running manual `kind`, `kubectl`, or `helm` commands. The cluster lifecycle must be fully managed through `ix local cluster` subcommands so that onboarding is reproducible and safe.

**Stakeholders** need:

1. A single command (`ix local cluster up`) that bootstraps the kind cluster and deploys all default services in one step.
2. A guarded teardown command (`ix local cluster down`) that requires confirmation before destroying cluster state.
3. A read-only status command (`ix local cluster status`) that shows node health and unhealthy pods without side effects.

## Priority

Must-Have

## Acceptance

- **StR-003-AC-1**: `ix local cluster up` bootstraps the kind cluster and deploys all ix-core tagged services in one command.
- **StR-003-AC-2**: `ix local cluster down` requires explicit confirmation (or `--yes`) before deleting the cluster.
- **StR-003-AC-3**: `ix local cluster status` shows current node readiness and any unhealthy pods without modifying cluster state.
