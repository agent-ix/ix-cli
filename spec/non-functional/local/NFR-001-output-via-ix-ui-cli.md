---
id: NFR-001
title: "All Terminal Output Routes Through @agent-ix/ix-ui-cli"
artifact_type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-ui/spec/functional/cli/FR-013"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-ui/spec/functional/cli/FR-016"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-ui/spec/non-functional/cli/NFR-002"
    type: "requires"
    cardinality: "1:1"
---

## Statement

Every command handler in `ix-cli` (across `packages/local`, `packages/elements`, and `apps/ix`) SHALL route all terminal output through `@agent-ix/ix-ui-cli`. The visual layout — glyphs, indents, connectors, header rendering, color palette — is owned entirely by ix-ui-cli. ix-cli MUST NOT define its own framing helpers, hand-roll ANSI sequences, or duplicate any visual token from ix-ui-cli's style module.

Direct calls to `console.log`, `console.error`, `console.warn`, or `process.stderr.write` are prohibited in any `packages/*/src/` or `apps/*/src/` directory of this repo.

## Rationale

ix-ui-cli is the design system. Centralizing visual decisions there means a single tweak (e.g. shifting the tail connector right by 3 columns, swapping the orbit glyph) propagates across every `ix` command and every third-party plugin without touching ix-cli source. Letting ix-cli inline its own ANSI sequences or define alternative framing helpers silently forks the design language and defeats the centralization (ix-ui FR-016, NFR-003).

## Output Routing Table

| Use Case | Permitted ix-ui-cli API |
|----------|-------------------------|
| Command frame (header + body + tail) | `startListing(name)` → `Listing` handle |
| Body content | `list.group(name)`, `list.item(name, desc?)`, `list.note(text)`, `list.raw(text)` |
| Hand-off to listr/clack mid-command | `list.commit()` then run external lib |
| Interactive prompt mid-command | `list.pause(() => password({...}))` |
| Command end | `list.success(msg)` / `list.warn(msg)` / `list.error(msg)` |
| Multi-service / multi-phase progress | `new PhaseTable<Phase>(...)` |
| Color helpers | `colors.*`, `blue` from `@agent-ix/ix-ui-cli` |
| Layout tokens (custom renderers only) | Re-exported from `@agent-ix/ix-ui-cli` (`ROW_INDENT`, `ROUTE_OUT`, `GLYPH_DONE`, `PHASE_PASS`, `phaseRun`, `renderHeader`, etc.) |

## Acceptance Criteria

- **NFR-001-AC-1**: A static grep for `console\.log\|console\.error\|console\.warn\|process\.stderr\.write` across `packages/*/src/` and `apps/*/src/` returns zero matches.
- **NFR-001-AC-2**: Every command handler that opens a frame uses `startListing` imported from `@agent-ix/ix-ui-cli`. No command handler defines its own `intro`/`outro` style helpers.
- **NFR-001-AC-3**: Multi-service progress uses `PhaseTable` imported from `@agent-ix/ix-ui-cli`, not a locally defined display class.
- **NFR-001-AC-4**: A static grep for the deprecated framing API (`introCommand|outroSuccess|outroError|outroWarning|outroInfo|runTaskList`) across `packages/*/src/` and `apps/*/src/` returns zero matches.
- **NFR-001-AC-5**: A static grep for inline ANSI escape sequences (`\\x1b\[`, `\\u001b\[`) and inline box-drawing connectors (`└──┐`, `└──•`, `└──`) across `packages/*/src/` and `apps/*/src/` returns zero matches outside test files. (All such tokens come from `@agent-ix/ix-ui-cli`.)

## Verification

The static-check test suite (`packages/*/tests/static-checks.test.ts`) runs each grep above and fails the build on any match. CI catches violations on every push.
