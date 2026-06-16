---
id: FR-010
title: "packages/elements — ix elements list"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "N:1"
---

## Description

`ix elements list` resolves all element types across configured taps and renders them grouped by tap source.

## Acceptance Criteria

- **FR-010-AC-1**: Output groups element types by tap URL, with the root tap (`github.com/agent-ix`) appearing first.
- **FR-010-AC-2**: Each entry shows the element type name and, if present, its description from `spec/spec.md` frontmatter.
- **FR-010-AC-3**: With `--refresh`, the cache is bypassed and results are re-fetched from all taps.
- **FR-010-AC-4**: When no elements are found, a message directs the user to add a tap.
- **FR-010-AC-5**: All output is rendered via `@agent-ix/ix-ui-cli` — no raw `console.log` in the command handler.

## Implementation Notes

- Resolution order per tap: `<org>/ix-elements/registry.yaml` index → GitHub topic search `topic:ix-element org:<org>`.
- Element metadata is sourced from `spec/spec.md` YAML frontmatter (`component_type: template`, `template_for`, `name`, `description`).
- Cache TTL: 1 hour at `~/.cache/ix/elements/<tap-slug>.json`.
