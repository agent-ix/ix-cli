---
id: StR-002
title: "Consistent Terminal UX Across All ix Commands"
type: StR
relationships:
  - target: "ix://agent-ix/ix-ui/spec/stakeholder/StR-001"
    type: "depends_on"
    cardinality: "1:1"
---

## Stakeholder Need

Every Agent IX CLI command should feel like it comes from the same design system. Inconsistent ANSI colours, different spinner styles, and raw `console.log` output across packages make the tool feel fragmented.

All `ix` subcommands SHALL render output exclusively through `@agent-ix/ix-ui-cli` so that:
- Intro/outro banners use the same cyan-black framing
- Progress tables use the canonical `PhaseTable` component
- Error messages use the muted terracotta red (ANSI 256, index 167)
- No raw `console.log` or `process.stderr.write` calls appear in command handlers

## Rationale

Inconsistent colours, spinner styles, and raw output across packages make the
tool feel like several disjoint products rather than one. Routing every command
through `@agent-ix/ix-ui-cli` centralizes the visual language so a single design
change propagates everywhere and no package can silently fork the look and feel.

## Priority

Must-Have

## Validation Criteria

- **StR-002-AC-1**: All ix commands use `@agent-ix/ix-ui-cli` wrappers for all terminal output.
- **StR-002-AC-2**: A grep for `console\.log` or `process\.stderr\.write` in `packages/local/src/` returns zero matches.
- **StR-002-AC-3**: Multi-service progress (e.g., `ix up <app>`) renders via `PhaseTable` from `@agent-ix/ix-ui-cli`.
