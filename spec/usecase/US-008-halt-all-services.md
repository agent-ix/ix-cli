---
id: US-008
title: "Developer Halts All Running Services Without Destroying the Cluster"
type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **developer**, I want to run `ix local halt all` in image mode and have every deployed service uninstalled in one step, so that I can free cluster resources between work sessions without keeping the cluster running services I don't need, and without resorting to manual `helm uninstall` loops.

## Context

Today `ix local halt all` (image mode) is rejected with `"all" requires --from-source`, so there is no built-in way to stop everything that `ix local up` deployed. `halt all` should mirror `up`'s registry enumeration in image mode, list every release that will be removed, prompt for confirmation (because the action is destructive across the whole cluster), and only then uninstall. A `--yes` flag bypasses the prompt for scripted use. Named-service halt (`ix local halt build`) keeps its current immediate behavior — only `all` triggers the prompt because only `all` is broad enough to cause regret.

## Acceptance

- **US-008-AC-1**: Running `ix local halt all` (no flags) lists every deployable that will be uninstalled, then prompts for confirmation; declining leaves the cluster unchanged.
- **US-008-AC-2**: Running `ix local halt all --yes` uninstalls every deployable without prompting.
- **US-008-AC-3**: Running `ix local halt <name>` continues to act immediately on a single deployable, with no prompt.
- **US-008-AC-4**: After successful `halt all`, the cluster itself remains running — only the deployable releases are gone, and `ix local up` can redeploy without re-running `init`.
