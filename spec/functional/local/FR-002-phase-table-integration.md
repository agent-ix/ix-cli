---
id: FR-002
title: "Startup Display via PhaseTable — Replaces AppDisplay"
type: FR
relationships:
  - target: "ix://agent-ix/ix-local-cli/spec/functional/FR-022"
    type: "migrated_from"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-ui/spec/functional/cli/FR-001"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-ui/spec/functional/cli/FR-002"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-ui/spec/functional/cli/FR-003"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-037"
    type: "requires"
    cardinality: "1:1"
---

## Description

The multi-service startup display (`ix up <app>`) is implemented using `PhaseTable<Phase>` from `@agent-ix/ix-ui-cli`. The former `AppDisplay` class is not present in this package. The four-phase pipeline (`secrets` → `pull` → `install` → `ready`) is defined locally in `src/phases.ts` and passed to `PhaseTable` at construction.

## Phase Vocabulary

The local package defines the `Phase` type in `src/phases.ts`:

```ts
export type Phase = "secrets" | "pull" | "install" | "ready";
export const PHASES: readonly Phase[] = ["secrets", "pull", "install", "ready"];
export const PHASE_LABELS: Record<Phase, string> = {
  secrets: "secrets",
  pull: "pulling",
  install: "installing",
  ready: "ready",
};
```

## Construction Pattern

```ts
const display = new PhaseTable<Phase>(serviceNames, {
  phases: PHASES,
  phaseLabels: PHASE_LABELS,
  header: `ix local up · ${app.name}`,
  tailIngressHosts: config.hosts,
  initialLineCount: appHeaderText && process.stdout.isTTY ? 1 : 0,
});
```

`tailIngressHosts` MUST be the configured `IxConfig.hosts` (FR-037) in
priority order. PhaseTable performs the per-host suffix grouping in the
final ingress section (FR-004-AC-9); `packages/local` does NOT pre-group
URLs.

## Behavior

All display behaviors specified in ix-local-cli FR-022 are satisfied by delegating to `PhaseTable`. No display logic is duplicated in `packages/local`.

The `PhaseTable` component handles:

- TTY: cursor-up redraws at 80 ms, braille spinners, synchronized output markers
- Non-TTY: one `[T+Xs] service: phase state` line per transition
- Frozen summary with optional ingress URL section supplied by `tailIngressUrls`

## Screen Contract

`ix up <app|service>` SHALL keep registry information out of the header. The
registry appears only in preflight, followed by the deploy target kind:

```
 ⊙  [ ix local up · auth ]
 |
 • Loading Helm charts from ghcr.io
 |
 • Starting App: auth
 └──┐
    • auth-service 0.9.3        1/1                           12.1s
    • identity 0.10.2           1/1                           12.1s
    • permission-service 0.4.9  1/1                           12.1s
    • elapsed 12.1s · 3/3 ready

 ◎ Ingress · dev.ix
 └──┐
    →  https://auth.dev.ix
    →  https://identity.dev.ix

 ◎ Ingress · luna.ix
 └──┐
    →  https://auth.luna.ix
```

The ingress URLs shown in the final section SHALL come from the rendered Helm
manifest for the installed release. `packages/local` SHALL NOT synthesize URLs
from the release name plus `config.hosts` — under multi-host configs (FR-037)
a single release renders one ingress host per entry in `domain.hosts`, and the
display section MUST reflect what was actually rendered, not what could be
inferred from the suffix list.

## Constraints

- **FR-002-CON-1**: `packages/local/src/` SHALL NOT contain a display or animation loop. All such logic lives in `@agent-ix/ix-ui-cli`.
- **FR-002-CON-2**: The `Phase` type is the only display-adjacent artifact permitted in `packages/local/src/phases.ts`. It defines the domain vocabulary, not rendering logic.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-002-AC-1 | `ix up <app>` renders a phase-column table using `PhaseTable<Phase>` imported from `@agent-ix/ix-ui-cli`. | Test |
| FR-002-AC-2 | All acceptance criteria from ix-local-cli FR-022 are satisfied via the `PhaseTable` component. | Test |
| FR-002-AC-3 | `grep -r "AppDisplay" packages/local/src/` returns zero matches. | Test |
| FR-002-AC-4 | The `Phase` type and `PHASES` constant are defined in `src/phases.ts` and not duplicated elsewhere in the package. | Test |
| FR-002-AC-5 | The header for `ix up <target>` is `ix local up · <target>` and SHALL NOT include the Helm registry. | Test |
| FR-002-AC-6 | The success frame passes all rendered ingress URLs to `PhaseTable` via `tailIngressUrls` (flat list, in chart-rendered order) AND the configured hosts via `tailIngressHosts = config.hosts`. PhaseTable groups URLs into per-host `◎ Ingress · <host>` blocks via longest-host-suffix match (FR-004-AC-9). If no Ingress exists, no ingress section is rendered. | Test |


- **FR-002-AC-1**: `ix up <app>` renders a phase-column table using `PhaseTable<Phase>` imported from `@agent-ix/ix-ui-cli`.
- **FR-002-AC-2**: All acceptance criteria from ix-local-cli FR-022 are satisfied via the `PhaseTable` component.
- **FR-002-AC-3**: `grep -r "AppDisplay" packages/local/src/` returns zero matches.
- **FR-002-AC-4**: The `Phase` type and `PHASES` constant are defined in `src/phases.ts` and not duplicated elsewhere in the package.
- **FR-002-AC-5**: The header for `ix up <target>` is `ix local up · <target>` and SHALL NOT include the Helm registry.
- **FR-002-AC-6**: The success frame passes all rendered ingress URLs to `PhaseTable` via `tailIngressUrls` (flat list, in chart-rendered order) AND the configured hosts via `tailIngressHosts = config.hosts`. PhaseTable groups URLs into per-host `◎ Ingress · <host>` blocks via longest-host-suffix match (FR-004-AC-9). If no Ingress exists, no ingress section is rendered.

## Dependencies

- **migrated_from**: ix-local-cli/spec/functional/FR-022
- **requires**: ix-ui/spec/functional/cli/FR-001
- **requires**: ix-ui/spec/functional/cli/FR-002
- **requires**: ix-ui/spec/functional/cli/FR-003
- **implements**: ix-cli/spec/usecase/US-002
- **requires**: ix-cli/spec/functional/local/FR-037
