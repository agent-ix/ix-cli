---
id: FR-009
title: "ClusterConfig — Default Service Set from ~/.ix/config.yaml"
type: FR
object: configuration
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-004"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-006"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-005"
    type: "requires"
    cardinality: "1:1"
---

## Description

`loadClusterConfig()` reads the `cluster:` key from `~/.ix/config.yaml` (the same file used by `loadConfig()` for pool and other settings). It returns a `ClusterConfig` object:

```typescript
interface ClusterConfig {
  defaultTags: string[];  // default: ["ix-core"]
  extraApps: string[];    // default: []
  skipApps: string[];     // default: []
}
```

**Parsing rules:**
- File absent → return defaults without error.
- File present, `cluster:` key absent → return defaults without error.
- `cluster:` key present but not an object → throw `ConfigValidationError`.
- Any field present but not a string array → throw `ConfigValidationError` with the field name.
- Valid sub-fields are merged with defaults for any fields not specified.

## Configuration

| Name | Scope | Type | Default | Description |
|---|---|---|---|---|
| `cluster.defaultTags` | creation | string[] | `["ix-core"]` | Tags selecting the default service set deployed at cluster bring-up. |
| `cluster.extraApps` | creation | string[] | `[]` | Additional apps to deploy beyond the tag-selected default set. |
| `cluster.skipApps` | creation | string[] | `[]` | Apps to exclude from the default set. |

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-009-AC-1 | Absent config file returns `{ defaultTags: ["ix-core"], extraApps: [], skipApps: [] }`. | Test |
| FR-009-AC-2 | Present config with valid `cluster:` key returns the parsed values. | Test |
| FR-009-AC-3 | Non-array value for any cluster field throws `ConfigValidationError`. | Test |
| FR-009-AC-4 | `cluster:` key absent in a valid YAML file returns defaults. | Test |
| FR-009-AC-5 | `ConfigValidationError` message identifies the offending field by name. | Test |

- **FR-009-AC-1**: Absent config file returns `{ defaultTags: ["ix-core"], extraApps: [], skipApps: [] }`.
- **FR-009-AC-2**: Present config with valid `cluster:` key returns the parsed values.
- **FR-009-AC-3**: Non-array value for any cluster field throws `ConfigValidationError`.
- **FR-009-AC-4**: `cluster:` key absent in a valid YAML file returns defaults.
- **FR-009-AC-5**: `ConfigValidationError` message identifies the offending field by name.

## Dependencies

- **implements**: ix-cli/spec/stakeholder/StR-004
- **implements**: ix-cli/spec/usecase/US-006
- **requires**: ix-cli/spec/functional/local/FR-005
