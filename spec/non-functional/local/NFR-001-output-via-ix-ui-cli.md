---
id: NFR-001
title: "All Terminal Output Routes Through @agent-ix/ix-ui-cli"
artifact_type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-ui/spec/non-functional/cli/NFR-002"
    type: "requires"
    cardinality: "1:1"
---

## Statement

`packages/local` command handlers SHALL route all terminal output through `@agent-ix/ix-ui-cli`. Direct calls to `console.log`, `console.error`, `console.warn`, or `process.stderr.write` are prohibited in `packages/local/src/`.

## Rationale

Centralizing output through ix-ui-cli ensures consistent framing (intro/outro banners, spinner style, colour palette) across all `ix` commands. It also makes test output deterministic — test runners can observe `process.stdout.write` without intercepting the console.

## Output Routing Table

| Use Case | Permitted ix-ui-cli API |
|----------|------------------------|
| Command start banner | `introCommand(name)` |
| Command success | `outroSuccess(msg)` |
| Command failure | `outroError(msg)` |
| Multi-service progress | `new PhaseTable<Phase>(...)` |
| Sequential task list | `runTaskList(title, tasks)` |
| Custom ANSI colours | `colors.*` from `@agent-ix/ix-ui-cli` |

## Acceptance Criteria

- **NFR-001-AC-1**: Static grep for `console\.log\|console\.error\|console\.warn\|process\.stderr\.write` across `packages/local/src/` returns zero matches.
- **NFR-001-AC-2**: `introCommand` and `outroSuccess`/`outroError` are imported from `@agent-ix/ix-ui-cli` in every command handler that uses intro/outro framing.
- **NFR-001-AC-3**: Multi-service progress (app expansion) uses `PhaseTable` imported from `@agent-ix/ix-ui-cli`, not a locally defined display class.
