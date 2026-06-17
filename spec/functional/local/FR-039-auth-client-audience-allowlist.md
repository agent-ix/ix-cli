---
id: FR-039
title: "Auth Client Audience Allowlist Rendering"
type: FR
object: configuration
---
# [FR-039] Auth Client Audience Allowlist Rendering

## Description

The local plugin **SHALL** own product-to-auth audience mappings used by local deploys. During `ix up`, the plugin renders the configured mapping into the `auth-service` Helm values as `AUTH_CLIENT_AUDIENCE_ALLOWLIST`, keeping product knowledge out of auth-service source code.

## Configuration

| Name | Scope | Type | Default | Description |
|---|---|---|---|---|
| `local.auth.clientAudienceAllowlist` | runtime | object (client id to string[] audiences) | `{ "filament-ui": ["filament"], "ix-cli": ["filament"] }` | Public client id to allowed JWT audiences; rendered into auth-service Helm values as `AUTH_CLIENT_AUDIENCE_ALLOWLIST` during `ix up`. The default allows both the browser SPA (`filament-ui`) and the CLI device client (`ix-cli`, the `DEFAULT_DEVICE_CLIENT_ID` in `ix-cli-core`) to request the `filament` audience, so `ix login <filament-host>` can obtain a filament-scoped token via the device flow. |

## Behavior

| ID | Behavior |
|---|---|
| FR-039-B-1 | `ix up auth-service` SHALL pass `ix-service.config.data.AUTH_CLIENT_AUDIENCE_ALLOWLIST` to the auth-service release |
| FR-039-B-2 | `ix up auth` SHALL pass `auth-service.ix-service.config.data.AUTH_CLIENT_AUDIENCE_ALLOWLIST` to the umbrella auth release |
| FR-039-B-3 | The rendered value SHALL be JSON suitable for auth-service `AUTH_CLIENT_AUDIENCE_ALLOWLIST` parsing |
| FR-039-B-4 | Re-running `ix up` with the same mapping SHALL leave the rendered ConfigMap unchanged |

## Acceptance Criteria

| ID | Criteria | Verification |
|---|---|---|
| FR-039-AC-1 | The local config schema accepts and defaults `auth.clientAudienceAllowlist` | Unit Test |
| FR-039-AC-2 | Single-service auth-service install args contain the allowlist Helm set value | Unit Test |
| FR-039-AC-3 | Umbrella auth install args contain the allowlist under the auth-service subchart prefix | Unit Test |
| FR-039-AC-4 | The `ix-service` chart Deployment template includes a config checksum annotation so ConfigMap changes roll pods exactly when the pod template changes | Helm Template Test |

## Follow-up

The default allowlist hardcodes the CLI device `client_id` (`ix-cli`) alongside each product SPA. A cleaner design lets each **service** declare the device `client_id` the CLI should present, rather than the auth allowlist enumerating a CLI-owned constant:

- Add an optional `device_client_id` field to the `AgentixServiceDiscovery` document (`/.well-known/agentix-service.json`, auth `ADR-011`, owned by `gateway-bff-contract` FR-003).
- `ix-cli-core`'s device-flow runner presents `discovery.device_client_id` (falling back to `DEFAULT_DEVICE_CLIENT_ID = "ix-cli"`) instead of a fixed constant, so each product BFF controls which client id reaches `auth-service`.
- The allowlist (this FR) then maps whatever `client_id` the service mandates to its audiences; products that keep `ix-cli` need no extra allowlist entry beyond what their service advertises.

This is additive (schema stays version `"1"`) and spans two repos (`gateway-bff-contract` model + `ix-cli-core` consumer), so it is deferred. The allowlist `ix-cli → ["filament"]` entry above unblocks `ix login` device flow today.

## Dependencies

- **Upstream**: see `relationships` in frontmatter.
