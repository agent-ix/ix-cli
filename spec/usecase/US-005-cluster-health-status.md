---
id: US-005
title: "Developer Inspects Cluster Node and Pod Health"
artifact_type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **developer**, I want to run `ix local cluster status` and see a summary of node readiness and any unhealthy pods, so that I can quickly diagnose cluster problems without running raw kubectl commands.

## Context

`ix local cluster status` runs `kubectl get nodes -o json` and `kubectl get pods -A -o json`, renders a node table (NAME, ROLE, STATUS, AGE), and if any pods are unhealthy renders a pod table (NAMESPACE, NAME, PHASE, RESTARTS). If all pods are healthy, it prints a single success line.

## Acceptance

- **US-005-AC-1**: A node table with NAME, ROLE, STATUS, AGE columns is always rendered.
- **US-005-AC-2**: When all pods are healthy, a single "All pods healthy." success message is shown without a pod table.
- **US-005-AC-3**: When unhealthy pods exist, a pod table listing NAMESPACE, NAME, PHASE, RESTARTS is shown.
- **US-005-AC-4**: The command makes no changes to cluster state.
