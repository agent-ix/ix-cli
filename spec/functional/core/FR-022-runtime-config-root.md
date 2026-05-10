---
id: FR-022
title: Runtime Config Root Override
type: functional-requirement
related:
  - StR-008
  - US-012
---
# FR-022 Runtime Config Root Override

The system SHALL support a runtime config root override through a global flag
and environment variable before plugin bootstrap.

## Acceptance Criteria

- FR-022-AC-1: Every command accepts a global `--config-root <dir>` option.
- FR-022-AC-2: Every command honors a distribution-specific config-root env var
  such as `IX_CONFIG_ROOT`.
- FR-022-AC-3: `--config-root` wins over the config-root env var.
- FR-022-AC-4: The selected config root applies to user config, user plugin
  manifests, and file-backed secrets.
- FR-022-AC-5: Project config still layers above the selected user config root
  unless `--no-project-config` is set.
- FR-022-AC-6: A missing config root is created lazily only by write commands;
  read commands can operate from schema defaults without creating files.

## Precedence

```text
flags > env > project config > selected user config root > distribution defaults > schema defaults
```

