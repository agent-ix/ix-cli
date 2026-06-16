---
id: US-002
title: "Developer Monitors Concurrent Service Startup Progress"
type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-local-cli/spec/usecase/US-013"
    type: "migrated_from"
    cardinality: "1:1"
---

## Story

As a **developer**, I want to see the deployment state of each service in real time — which phase it is in, how long it has been running, and whether it is blocked in a queue — so that I can quickly identify stalled or failing services without tailing logs manually.

## Context

The phase-column table rendered by `PhaseTable<Phase>` from `@agent-ix/ix-ui-cli` replaces the former `AppDisplay` component. It redraws in place on TTY every 80 ms using braille spinners for active phases, and emits plain-text event lines on non-TTY / CI.

## Acceptance

- **US-002-AC-1**: TTY output redraws the entire service table in place without scrolling.
- **US-002-AC-2**: Services blocked on a concurrency pool slot show the `queued` glyph.
- **US-002-AC-3**: Each service row shows elapsed time since its pipeline began.
- **US-002-AC-4**: The display is rendered exclusively by `PhaseTable` from `@agent-ix/ix-ui-cli`; no local display logic is duplicated in `packages/local`.
