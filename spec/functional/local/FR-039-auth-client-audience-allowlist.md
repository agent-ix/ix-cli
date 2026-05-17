---
id: FR-039
title: "Auth Client Audience Allowlist Rendering"
artifact_type: FR
object: configuration
---
# [FR-039] Auth Client Audience Allowlist Rendering

## Description

The local plugin **SHALL** own product-to-auth audience mappings used by local deploys. During `ix up`, the plugin renders the configured mapping into the `auth-service` Helm values as `AUTH_CLIENT_AUDIENCE_ALLOWLIST`, keeping product knowledge out of auth-service source code.

## Configuration

| Path | Default | Description |
|---|---|---|
| `local.auth.clientAudienceAllowlist` | `{ "filament-ui": ["filament"] }` | Public client id to allowed JWT audiences |

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
