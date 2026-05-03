---
id: FR-033
title: "Image-Mode Secrets Contract Loaded from Published Chart Tgz"
artifact_type: FR
object: process
relationships:
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-008"
    type: "extends"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-031"
    type: "extends"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-032"
    type: "extends"
    cardinality: "1:1"
---

## Behavior

Image-mode installs (`ix local up <service>` without `--from-source`) must not
require a local repo checkout to apply service secrets. The `ix-local.secrets.yaml`
file is packaged into every published chart tgz; `runImageModeUp` reads it from
there rather than from the local filesystem.

### App (umbrella) mode

Phase order changes to: **pull → secrets → install → ready**.

After pulling the umbrella tgz, `runImageModeUp` extracts it to a temporary
directory and locates each subchart tgz under `<umbrella>/charts/<name>-<version>.tgz`.
For each subchart, `loadSecretContractFromTgz` extracts the subchart tgz to a
second temporary directory, calls `loadSecretContract` on the extracted chart
directory, and returns the parsed contract (or `null` if `ix-local.secrets.yaml`
is absent). Contracts are applied in the secrets phase that follows pull.

### Single-service mode

Before the Listr task list runs, `runImageModeUp` pulls the service chart tgz
to a temporary directory, calls `loadSecretContractFromTgz` on the pulled file,
and passes any resolved contract to `runSingleServiceListr`. The service is then
installed from the local tgz path (not a second OCI fetch). The temporary
directory is deleted in a `finally` block regardless of outcome.

### devDir removed from image mode

`runImageModeUp` no longer accepts or uses a `devDir` parameter.
`findSecretContractDir` is not called from `up-image.ts`. Source mode
(`up-source.ts`) retains `devDir`-based discovery — unchanged.

### Graceful skip

Charts that do not include `ix-local.secrets.yaml` cause `loadSecretContractFromTgz`
to return `null`. No error is raised; the secrets phase for that service
transitions directly to `done`.

## Acceptance

- **FR-033-AC-1**: `local-secrets.ts` exports `loadSecretContractFromTgz(tgzPath, chartName)`
  which extracts the tgz via `tar -xzf` (no npm tar dependency), calls
  `loadSecretContract` on the extracted directory, cleans up the temp dir in a
  `finally` block, and returns `null` when `ix-local.secrets.yaml` is absent.
- **FR-033-AC-2**: `up-image.ts` does not import or call `findSecretContractDir`.
- **FR-033-AC-3**: `runImageModeUp` does not declare or use a `devDir` parameter.
- **FR-033-AC-4**: `UP_PHASES` in `up-image.ts` lists `"pull"` before `"secrets"`.
- **FR-033-AC-5**: For app mode, `contractsByName` is populated from subchart tgzs
  extracted from the umbrella, after the umbrella pull completes.
- **FR-033-AC-6**: For single-service mode, `runImageModeUp` pulls the chart tgz
  before calling `runSingleServiceListr`; the install uses the local tgz path.
- **FR-033-AC-7**: A chart tgz containing no `ix-local.secrets.yaml` results in
  the secrets phase completing silently with `done` status (not `failed`).
- **FR-033-AC-8**: All temporary directories created during tgz extraction are
  deleted in `finally` blocks, regardless of outcome.
