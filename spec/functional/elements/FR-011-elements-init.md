---
id: FR-011
title: "packages/elements — ix elements init"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "N:1"
---

## Description

`ix elements init <type> <name>` scaffolds a new project by resolving an element type to its cookiecutter repo, running the template, and setting up git and GitHub.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-011-AC-1 | Resolves `<type>` against all configured taps; errors with a helpful message if not found. | Test |
| FR-011-AC-2 | Clones the element repo to `~/.cache/ix/elements/repos/<name>/`; performs `git pull --ff-only` if already cached. | Test |
| FR-011-AC-3 | Runs `cookiecutter <template-dir> --no-input --output-dir <cwd> project_name=<name> org=<org>`. | Test |
| FR-011-AC-4 | Runs `git init -b main`, `git add -A`, and an initial commit with message `feat: scaffold from <template-name> (<type>)` in the generated directory. | Test |
| FR-011-AC-5 | Runs `gh repo create <org>/<slug> --private --source=. --remote=origin --push` to create and push the GitHub repo. | Test |
| FR-011-AC-6 | `--no-git` skips AC-4 and AC-5. `--no-github` skips AC-5 only. | Test |
| FR-011-AC-7 | `--org <org>` overrides the default org (`agent-ix`). | Test |


- **FR-011-AC-1**: Resolves `<type>` against all configured taps; errors with a helpful message if not found.
- **FR-011-AC-2**: Clones the element repo to `~/.cache/ix/elements/repos/<name>/`; performs `git pull --ff-only` if already cached.
- **FR-011-AC-3**: Runs `cookiecutter <template-dir> --no-input --output-dir <cwd> project_name=<name> org=<org>`.
- **FR-011-AC-4**: Runs `git init -b main`, `git add -A`, and an initial commit with message `feat: scaffold from <template-name> (<type>)` in the generated directory.
- **FR-011-AC-5**: Runs `gh repo create <org>/<slug> --private --source=. --remote=origin --push` to create and push the GitHub repo.
- **FR-011-AC-6**: `--no-git` skips AC-4 and AC-5. `--no-github` skips AC-5 only.
- **FR-011-AC-7**: `--org <org>` overrides the default org (`agent-ix`).

## Implementation Notes

- `cookiecutter` must be installed on the host (Python CLI tool).
- Git and `gh` CLI must be available.
- The generated directory slug is derived from project name: lowercased, spaces → hyphens.

## Dependencies

- **implements**: ix-cli/spec/stakeholder/StR-001
