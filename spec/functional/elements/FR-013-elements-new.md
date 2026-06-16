---
id: FR-013
title: "packages/elements — ix elements new"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "N:1"
---

## Description

`ix elements new <name>` scaffolds a new element type: a cookiecutter repo with correct `spec/spec.md` frontmatter and the `ix-element` GitHub topic set.

## Acceptance Criteria

- **FR-013-AC-1**: Creates a new repo from a meta-template (`element-cookiecutter-cookiecutter`) with directory structure: `spec/`, `hooks/`, `{{ cookiecutter.project_slug }}/`.
- **FR-013-AC-2**: `spec/spec.md` is initialised with `component_type: template` and `template_for: [<name>]` in YAML frontmatter.
- **FR-013-AC-3**: Sets `ix-element` GitHub topic via `gh repo edit --add-topic ix-element`.
- **FR-013-AC-4**: Instructs user to add their org as a tap if not already present.

## Implementation Notes

- Requires a `element-cookiecutter-cookiecutter` meta-template (tracked as future work — current implementation prints manual steps).
- Once the meta-template exists, this command follows the same clone → cookiecutter → git → gh flow as `ix elements init`.
