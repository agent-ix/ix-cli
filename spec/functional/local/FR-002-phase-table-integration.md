---
id: FR-002
title: "Startup Display via PhaseTable — Replaces AppDisplay"
artifact_type: FR
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
---

## Description

The multi-service startup display (`ix up <app>`) is implemented using `PhaseTable<Phase>` from `@agent-ix/ix-ui-cli`. The former `AppDisplay` class is not present in this package. The four-phase pipeline (`secrets` → `pull` → `install` → `ready`) is defined locally in `src/phases.ts` and passed to `PhaseTable` at construction.

## Phase Vocabulary

The local package defines the `Phase` type in `src/phases.ts`:

```ts
export type Phase = "secrets" | "pull" | "install" | "ready";
export const PHASES: readonly Phase[] = ["secrets", "pull", "install", "ready"];
export const PHASE_LABELS: Record<Phase, string> = {
  secrets:  "secrets",
  pull:     "pulling",
  install:  "installing",
  ready:    "ready",
};
```

## Construction Pattern

```ts
const display = new PhaseTable<Phase>(serviceNames, {
  phases:      PHASES,
  phaseLabels: PHASE_LABELS,
  header:      `ix up · ${app.name} · ${registry}`,
  initialLineCount: appHeaderText && process.stdout.isTTY ? 1 : 0,
});
```

## Behavior

All display behaviors specified in ix-local-cli FR-022 are satisfied by delegating to `PhaseTable`. No display logic is duplicated in `packages/local`.

The `PhaseTable` component handles:
- TTY: cursor-up redraws at 80 ms, braille spinners, synchronized output markers
- Non-TTY: one `[T+Xs] service: phase state` line per transition
- `finish(entry?, baseDomain?)`: frozen summary with optional app URL

## Constraints

- **FR-002-CON-1**: `packages/local/src/` SHALL NOT contain a display or animation loop. All such logic lives in `@agent-ix/ix-ui-cli`.
- **FR-002-CON-2**: The `Phase` type is the only display-adjacent artifact permitted in `packages/local/src/phases.ts`. It defines the domain vocabulary, not rendering logic.

## Acceptance Criteria

- **FR-002-AC-1**: `ix up <app>` renders a phase-column table using `PhaseTable<Phase>` imported from `@agent-ix/ix-ui-cli`.
- **FR-002-AC-2**: All acceptance criteria from ix-local-cli FR-022 are satisfied via the `PhaseTable` component.
- **FR-002-AC-3**: `grep -r "AppDisplay" packages/local/src/` returns zero matches.
- **FR-002-AC-4**: The `Phase` type and `PHASES` constant are defined in `src/phases.ts` and not duplicated elsewhere in the package.
