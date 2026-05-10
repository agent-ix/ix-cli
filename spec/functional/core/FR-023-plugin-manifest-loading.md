---
id: FR-023
title: Plugin Manifest Loading
type: functional-requirement
related:
  - StR-008
  - US-012
---
# FR-023 Plugin Manifest Loading

The system SHALL load enabled plugins from distribution defaults, user plugin
manifests, and project plugin manifests.

## Acceptance Criteria

- FR-023-AC-1: Distribution default plugins load first.
- FR-023-AC-2: User-enabled plugins load after distribution defaults.
- FR-023-AC-3: Project-enabled plugins load after user plugins.
- FR-023-AC-4: A later layer can disable a plugin from an earlier layer.
- FR-023-AC-5: Plugin manifest entries include plugin id, package specifier,
  enabled state, and optional version constraint.
- FR-023-AC-6: Plugin id validation uses the same id rules as config and
  secrets namespacing.
- FR-023-AC-7: Plugin load failures are isolated; a failed optional plugin is
  reported without preventing unrelated plugins from loading.

## Manifest Shape

```yaml
plugins:
  workflow:
    package: "@agent-ix/ix-agent-skills-workflow-cli"
    enabled: true
    version: "^0.1.0"
```

