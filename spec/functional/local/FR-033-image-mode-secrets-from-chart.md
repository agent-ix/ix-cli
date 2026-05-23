---
id: FR-033
title: "Image-Mode Secrets Contract Loaded from Published Chart Package"
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
require a local repo checkout to apply service secrets. When a deployable uses
an image-mode secret contract, the `ix-local.secrets.yaml` file SHALL live
inside the chart source directory that is packaged into the published chart
artifact. Repo-root files that sit outside the packaged chart directory do not
count: Helm package output omits them, and image mode therefore cannot rely on
them. `runImageModeUp` reads the contract from the pulled chart artifact rather
than from the local filesystem.

### App (umbrella) mode

Phase order changes to: **pull → secrets → install → ready**.

After pulling the umbrella chart package, `runImageModeUp` extracts it to a
temporary directory and inspects each bundled subchart under
`<umbrella>/charts/`. Published umbrella charts MAY vendor subcharts either as
directories (for example `<umbrella>/charts/<name>/...`) or as packaged tgzs
(` <umbrella>/charts/<name>-<version>.tgz` ). The loader SHALL support both.

When a bundled subchart is a directory, `runImageModeUp` calls
`loadSecretContract` on that directory directly. When a bundled subchart is a
tgz, `loadSecretContractFromTgz` extracts the subchart tgz to a second
temporary directory, calls `loadSecretContract` on the extracted chart
directory, and returns the parsed contract (or `null` if
`ix-local.secrets.yaml` is absent). Contracts are applied in the secrets phase
that follows pull.

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

Charts that do not include `ix-local.secrets.yaml` cause the chart-package
secret loader to return `null`. No error is raised; the secrets phase for that
service transitions directly to `done`.

This graceful skip applies only to charts that genuinely define no image-mode
secret contract. A deployable whose rendered manifests or hook jobs reference a
required Secret but whose published chart artifact omits the corresponding
`ix-local.secrets.yaml` is an artifact defect.

## Acceptance

- **FR-033-AC-1**: `local-secrets.ts` exports `loadSecretContractFromTgz(tgzPath, chartName)`
  which extracts the tgz via `tar -xzf` (no npm tar dependency), calls
  `loadSecretContract` on the extracted directory, cleans up the temp dir in a
  `finally` block, and returns `null` when `ix-local.secrets.yaml` is absent.
- **FR-033-AC-2**: `up-image.ts` does not import or call `findSecretContractDir`.
- **FR-033-AC-3**: `runImageModeUp` does not declare or use a `devDir` parameter.
- **FR-033-AC-4**: `UP_PHASES` in `up-image.ts` lists `"pull"` before `"secrets"`.
- **FR-033-AC-5**: For app mode, `contractsByName` is populated from bundled
  subcharts extracted from the umbrella after the umbrella pull completes,
  regardless of whether those bundled subcharts are vendored as directories or
  tgzs.
- **FR-033-AC-6**: For single-service mode, `runImageModeUp` pulls the chart tgz
  before calling `runSingleServiceListr`; the install uses the local tgz path.
- **FR-033-AC-7**: A chart tgz containing no `ix-local.secrets.yaml` results in
  the secrets phase completing silently with `done` status (not `failed`).
- **FR-033-AC-8**: All temporary directories created during tgz extraction are
  deleted in `finally` blocks, regardless of outcome.
- **FR-033-AC-9**: When an umbrella chart vendors a subchart as
  `<umbrella>/charts/<name>/`, `runImageModeUp` SHALL load
  `<umbrella>/charts/<name>/ix-local.secrets.yaml` if present instead of
  requiring a sibling `.tgz`.
- **FR-033-AC-10**: The directory-based app-mode loader SHALL import and call
  `loadSecretContract` for bundled subchart directories.
- **FR-033-AC-11**: A chart that expects image-mode secret materialization
  SHALL place `ix-local.secrets.yaml` inside the packaged chart source tree
  (for example `chart/ix-local.secrets.yaml` in source, yielding
  `<chart>/ix-local.secrets.yaml` in the published artifact). A repo-root file
  outside the packaged chart directory is non-conformant.
- **FR-033-AC-12**: If a rendered manifest or Helm hook references a Secret
  that would normally be materialized from `ix-local.secrets.yaml`, omission of
  that contract from the published chart artifact is an artifact defect, not a
  valid graceful-skip case.

## Workflow

```mermaid
sequenceDiagram
    actor User
    participant CLI as ix local up <target>
    participant ImageUp as runImageModeUp
    participant Helm as helm
    participant Tar as tar -xzf
    participant Loader as loadSecretContract / loadSecretContractFromTgz
    participant Kubectl as kubectl

    User->>CLI: ix local up <target>
    CLI->>ImageUp: runImageModeUp(deployable, config, ...)
    ImageUp->>Helm: helm pull <chart-or-umbrella-oci-ref> -d <tmpDir>
    Helm-->>ImageUp: <tmpDir>/<chart>.tgz
    alt role === "app" (umbrella)
        ImageUp->>Tar: extract umbrella .tgz → <tmpDir>/<umbrella>/
        Tar-->>ImageUp: <umbrella>/charts/<sub>/ or <umbrella>/charts/<sub>-<ver>.tgz
        loop for each bundled subchart
            alt subchart is a directory
                ImageUp->>Loader: loadSecretContract(<umbrella>/charts/<sub>/)
            else subchart is a .tgz
                ImageUp->>Loader: loadSecretContractFromTgz(<sub>.tgz, <sub>)
                Loader->>Tar: extract <sub>.tgz to second tmpDir
                Tar-->>Loader: <sub>/ContractDir
                Loader->>Loader: loadSecretContract(extracted dir)
            end
            Loader-->>ImageUp: SecretContract | null (graceful skip if absent)
        end
    else single-service
        ImageUp->>Loader: loadSecretContractFromTgz(<chart>.tgz, <chartName>)
        Loader-->>ImageUp: SecretContract | null
    end
    ImageUp->>Kubectl: apply rendered Secrets per subchart (secrets phase, parallel)
    Kubectl-->>ImageUp: ok / done
    ImageUp->>Helm: helm upgrade --install ... (uses local <chart>.tgz path; no second OCI fetch)
    Helm-->>ImageUp: release applied
    ImageUp->>ImageUp: finally → rm -rf tmpDirs (FR-033-AC-8)
    ImageUp-->>User: PhaseTable: pull → secrets → install → ready
```

