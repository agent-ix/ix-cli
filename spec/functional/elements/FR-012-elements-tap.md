---
id: FR-012
title: "packages/elements — ix elements tap (add / remove / list)"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "N:1"
---

## Description

The `ix elements tap` subcommand group manages the list of tap sources from which elements are discovered.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-012-AC-1 | `ix elements tap add <url>` appends the URL to `~/.config/ix/elements-taps.yaml` and invalidates the cache for that tap. | Test |
| FR-012-AC-2 | Adding a duplicate tap is a no-op with a confirmation message. | Test |
| FR-012-AC-3 | Accepted formats: `github.com/<org>` (org tap) and `github.com/<org>/<repo>` (single-repo tap). | Test |
| FR-012-AC-4 | `ix elements tap remove <url>` removes the tap from config and invalidates its cache. | Test |
| FR-012-AC-5 | Attempting to remove the root tap (`github.com/agent-ix`) raises an error. | Test |
| FR-012-AC-6 | `ix elements tap list` renders all configured taps, marking the root tap with `(root)`. | Test |
| FR-012-AC-7 | The root tap is always present even when no config file exists. | Test |


### tap add
- **FR-012-AC-1**: `ix elements tap add <url>` appends the URL to `~/.config/ix/elements-taps.yaml` and invalidates the cache for that tap.
- **FR-012-AC-2**: Adding a duplicate tap is a no-op with a confirmation message.
- **FR-012-AC-3**: Accepted formats: `github.com/<org>` (org tap) and `github.com/<org>/<repo>` (single-repo tap).

### tap remove
- **FR-012-AC-4**: `ix elements tap remove <url>` removes the tap from config and invalidates its cache.
- **FR-012-AC-5**: Attempting to remove the root tap (`github.com/agent-ix`) raises an error.

### tap list
- **FR-012-AC-6**: `ix elements tap list` renders all configured taps, marking the root tap with `(root)`.
- **FR-012-AC-7**: The root tap is always present even when no config file exists.

## Implementation Notes

- Config file: `~/.config/ix/elements-taps.yaml` — created on first `tap add`.
- The root tap is prepended automatically if absent when the config is loaded.

## Dependencies

- **implements**: ix-cli/spec/stakeholder/StR-001
