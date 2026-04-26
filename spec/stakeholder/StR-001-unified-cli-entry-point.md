---
id: StR-001
title: "Unified CLI Entry Point for the Agent IX Ecosystem"
artifact_type: StR
relationships: []
---

## Stakeholder Need

Developers working across Agent IX projects currently use separate CLIs per concern (ix-local-cli for cluster commands, ad-hoc scripts for spec workflows, manual curl for auth). This creates friction: different install paths, inconsistent UX, and no shared auth session.

**Stakeholders** need a single `ix` binary that:

1. Authenticates once and shares the session across all subcommands
2. Provides local cluster management (`ix up`, `ix down`) under one command tree
3. Exposes element scaffolding (`ix elements`) and spec workflows (`ix spec`) as first-class subcommands
4. Supports third-party packages extending the command tree via a typed plugin interface

## Priority

Must-Have

## Acceptance

- **StR-001-AC-1**: A single `ix` binary provides all Agent IX CLI functionality.
- **StR-001-AC-2**: `ix login` authenticates once; all subcommands resolve credentials from `~/.config/ix/credentials.json` without re-prompting.
- **StR-001-AC-3**: `ix up`, `ix elements`, and `ix spec` are co-installable from a single package.
