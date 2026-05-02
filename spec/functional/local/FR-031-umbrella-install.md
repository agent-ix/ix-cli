---
id: FR-031
title: "Umbrella App Install — Single Helm Release per App, Per-Subchart Watchers"
artifact_type: FR
object: process
relationships:
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-008"
    type: "extends"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-013"
    type: "extends"
    cardinality: "1:1"
---

## Behavior

`runImageModeUp` collapses an app-role deployable into a **single Helm
release** per umbrella chart, instead of one release per declared subchart.

The umbrella's `Chart.yaml` deps still drive what gets deployed and, by
extension, which rows the `PhaseTable` shows. Helm itself topologically
installs the subcharts inside one release; ix-cli runs per-subchart
`kubectl rollout status` watchers in parallel during the `ready` phase to
stream live status into each row.

### Phase mapping in umbrella mode

- **secrets** — per-subchart, parallel (unchanged from FR-013).
- **pull** — single `helm pull` of the umbrella OCI ref. All rows transition
  `running → done` together when the tarball lands.
- **install** — single `helm upgrade --install` against the pulled umbrella
  tarball. All rows transition `running → done` together when helm returns.
  No `--wait` / `--atomic` — opaque waits would defeat the per-subchart
  watcher visibility.
- **ready** — per-subchart, parallel. Each row's watcher polls
  `kubectl rollout status` filtered by `app.kubernetes.io/part-of=<subchart>`.

### Settling indicator

`getDeploymentStatus` (in `rollout.ts`) appends a `·` suffix to the
`ready/desired` count when pods are at `ready === desired` but the
Deployment has not finished reconciling — specifically when
`status.observedGeneration < metadata.generation` or
`status.availableReplicas < .spec.replicas`. This explains the "1/1 but
clock keeps ticking" case to the operator: pods are ready, the Deployment
controller hasn't acknowledged it yet.

## Acceptance

- **FR-031-AC-1**: For `deployable.role === "app"`, exactly one
  `helm upgrade --install <app-name> <umbrella-tgz>` runs per `ix up`
  invocation, regardless of how many subcharts the umbrella declares.
- **FR-031-AC-2**: Exactly one `helm pull` runs per umbrella per
  invocation; `pools.dockerPull` is no longer used in the app branch.
- **FR-031-AC-3**: Each subchart's row in the `PhaseTable` still shows
  `secrets / pull / install / ready` columns and transitions through them.
- **FR-031-AC-4**: Per-subchart `waitForRollout` watchers run in parallel
  during the `ready` phase, gated by `pools.kubectlWatch`, and stream
  pod-ready counts to the row via `display.setPodStatus`.
- **FR-031-AC-5**: When `helm pull` of the umbrella fails, all subchart
  rows show `pull failed` with the umbrella error message; the install
  short-circuits.
- **FR-031-AC-6**: When the umbrella `helm upgrade --install` fails, all
  subchart rows show `install failed` with the helm error message; rollout
  watchers are not started.
- **FR-031-AC-7**: When a subchart's rollout fails, only that row shows
  `ready failed`; sibling watchers continue to completion (FR-021-AC-5).
- **FR-031-AC-8**: `getDeploymentStatus` returns a `ready/desired·` string
  (with trailing `·`) when at least one workload reports
  `ready === desired` AND
  (`observedGeneration < generation` OR `availableReplicas < replicas`).
- **FR-031-AC-9**: A `helm history <app-name>` command shows a single
  unified release history for the whole umbrella.
- **FR-031-AC-10**: A `helm list` shows exactly one row per app instead of
  one per subchart.
