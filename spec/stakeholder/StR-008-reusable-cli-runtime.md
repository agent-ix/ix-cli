---
id: StR-008
title: Reusable CLI Runtime
type: stakeholder-requirement
---
# StR-008 Reusable CLI Runtime

Developers need the IX CLI runtime to be reusable across multiple CLI
distributions, not only the main `ix` binary.

## Acceptance Criteria

- StR-008-AC-1: The runtime supports a generic CLI distribution with no IX
  service dependency.
- StR-008-AC-2: The runtime supports an IX-connected CLI distribution with IX
  auth and service clients.
- StR-008-AC-3: The main `ix` CLI is represented as a distribution with an
  official default plugin bundle.
- StR-008-AC-4: The runtime can load additional user and project plugins on top
  of distribution defaults.

