---
id: US-006
title: "Operator Customizes Default Services for Cluster Bring-Up"
artifact_type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-004"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **platform engineer**, I want to configure which services are included in `ix local cluster up` by default, so that my team's environment includes the tools they need without requiring everyone to pass flags on every bring-up.

## Context

The `cluster:` key in `~/.ix/config.yaml` controls the effective deploy set: `defaultTags` selects services by OCI tag, `extraApps` adds specific services by name, and `skipApps` removes specific services by name. `skipApps` takes precedence over both tag-filter and `extraApps`.

## Acceptance

- **US-006-AC-1**: `cluster.defaultTags` in `~/.ix/config.yaml` controls which tag filter applies (default: `["ix-core"]`).
- **US-006-AC-2**: `cluster.extraApps` adds named services to the deploy set regardless of their tags.
- **US-006-AC-3**: `cluster.skipApps` removes named services from the deploy set even if they match `defaultTags` or appear in `extraApps`.
- **US-006-AC-4**: When the config file is absent, defaults are used without error.
- **US-006-AC-5**: Invalid config values (non-array fields) produce a clear `ConfigValidationError`.
