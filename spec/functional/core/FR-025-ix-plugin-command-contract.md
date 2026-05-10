---
id: FR-025
title: IxPlugin Command Contract
type: functional-requirement
related:
  - StR-008
  - US-012
---
# FR-025 IxPlugin Command Contract

The system SHALL expose a first-class `IxPlugin` contract from
`@agent-ix/ix-cli-core` that covers config schemas, secret declarations,
command metadata, and capability declarations.

The main `ix` application SHALL consume the same contract for built-in and
external plugin startup. Plugin command adapters SHALL read persistent
configuration through `ConfigService` using the plugin id declared by the
contract, then layer command flags over those values.

## Acceptance Criteria

- FR-025-AC-1: `IxPlugin` declares an id, optional config schema, optional env
  bindings, optional secrets schema, command registrations, and required or
  optional capabilities.
- FR-025-AC-2: Plugin ids are validated with the same rules used by config and
  secrets namespacing.
- FR-025-AC-3: Strict config schemas register with the config registry; non-strict
  schemas are rejected without registering.
- FR-025-AC-4: Secret declarations register through the existing secrets
  registry using `<plugin-id>.<secret-name>`.
- FR-025-AC-5: Duplicate plugin ids preserve the first registration and return a
  non-throwing failure result.
- FR-025-AC-6: Command registrations are normalized and exposed to hosts without
  requiring hosts to import plugin internals.
- FR-025-AC-7: Capability declarations distinguish required from optional
  capabilities so generic CLI distributions can reject missing mandatory
  bindings while allowing local-only commands.

## Contract Shape

```ts
interface IxPlugin {
  id: string;
  configSchema?: ZodObject<ZodRawShape>;
  envBindings?: Record<string, string>;
  secretsSchema?: SecretDeclaration[];
  commands?: IxCommandRegistration[];
  capabilities?: IxCapabilityDeclaration[];
}
```

## Errors

- `invalid-plugin-id`
- `non-strict-schema`
- `duplicate-id`
- `secret-registration-failed`
