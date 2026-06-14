---
id: US-010
title: "Operator Configures Multiple Ingress Hostnames for a Shared Cluster"
artifact_type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-007"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **platform engineer** running a cluster on a named, network-reachable
host (e.g. `luna`), I want to configure multiple hostname suffixes that the
cluster's ingress answers to so that the same release is reachable under
the local convention (`*.dev.ix`), the host's name (`*.luna.ix`), and
eventually the public name (`*.agent-ix.dev`) without re-deploying.

## Context

Operators set the suffix list once via the persistent `local` plugin
config (FR-037):

```bash
ix config set local domain.hosts '["dev.ix","luna.ix","agent-ix.dev"]'
ix local up
```

The first entry is canonical: it is what single-host code paths
(admin email, login URL, display banners, dnsmasq hint) use. Every
service publishes an ingress on this canonical suffix regardless of
opt-in — backends stay reachable on `*.dev.ix` for debugging.

Edge / gateway services (UIs that serve `/g/<service>/*` proxy
routes) opt into multi-host fanout per chart by setting
`ingress.exposeExtraHosts: true`. Those services then publish a
sibling ingress for every additional entry in `domain.hosts`. The
shared wildcard TLS certificate gains one `*.<host>` SAN per entry
automatically.

A one-shot CI override is supported via the legacy `IX_INTERNAL_BASE_DOMAIN`
env var (singular, pins to one entry) and the new
`IX_INTERNAL_BASE_DOMAINS` env var (plural, comma-separated).

## Acceptance

- **US-010-AC-1**: `ix config set local domain.hosts '["dev.ix","luna.ix"]'`
  persists the list to `~/.config/ix/config.d/local.yaml` and survives
  across `ix` invocations.
- **US-010-AC-2**: `ix config get local domain.hosts` round-trips the list.
- **US-010-AC-3**: A subsequent `ix local up` (or `ix local refresh`)
  renders every service's ingress with one host per entry in
  `domain.hosts` when the chart sets `ingress.exposeExtraHosts: true`,
  and only the canonical (first) entry when the chart leaves the
  default `false`.
- **US-010-AC-4**: The cluster's wildcard TLS certificate is issued
  with one `*.<host>` SAN per entry; HTTPS to any configured host
  presents a valid cert.
- **US-010-AC-5**: Setting `domain.hosts` to a list containing a
  single-label entry (e.g. `["ix"]`) is rejected at write time with a
  clear `ConfigValidationError` naming the offending entry.
- **US-010-AC-6**: `IX_INTERNAL_BASE_DOMAIN=ci.ix ix local up` overrides
  the persisted list with a single-entry `["ci.ix"]` for that
  invocation only; the persisted file is not mutated.

## Test Coverage

| AC | Verified by |
|---|---|
| US-010-AC-1 | Inherits `ix://agent-ix/ix-cli-core/FR-004` (persistent plugin schema) + `ix://agent-ix/ix-cli-core/FR-008` (`ix config set`); covered by TC-037 (write-time rejection round-trip). |
| US-010-AC-2 | Inherits `ix://agent-ix/ix-cli-core/FR-008` generic round-trip semantics. |
| US-010-AC-3 | Integration: `helm template charts/ix-service` against multi-host config — `helm-charts` repo `helm lint` + manual `helm template` recipe in this FR's verification. |
| US-010-AC-4 | Integration: inspect `kubectl get cert ix-tls -n ingress-nginx -o yaml` after `ix local init`. |
| US-010-AC-5 | TC-036 (load-time rejection of single-label entries) + TC-037 (write-time rejection by `ix config set`). |
| US-010-AC-6 | TC-035 (legacy singular env var pins the list). |
