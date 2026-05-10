---
id: US-012
title: Run Custom CLI Distribution
type: user-story
priority: P1
---
# US-012 Run Custom CLI Distribution

As a tool author, I want to build a CLI distribution using the shared IX CLI
runtime, so that I can reuse config, secrets, plugin loading, and terminal
style without shipping the full main `ix` plugin bundle.

## Acceptance Criteria

- US-012-AC-1: Given a distribution manifest, when the CLI starts, then the
  runtime loads the distribution's default plugins.
- US-012-AC-2: Given a user plugin manifest, when the CLI starts, then enabled
  user plugins are loaded after distribution defaults.
- US-012-AC-3: Given a project plugin manifest, when the CLI runs inside that
  project, then enabled project plugins are loaded after user plugins.
- US-012-AC-4: Given `--config-root`, when a command runs, then user-level
  config, plugin manifests, and file-backed secrets resolve from that root.

