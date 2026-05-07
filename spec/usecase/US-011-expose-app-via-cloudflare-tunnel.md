---
id: US-011
title: "Operator Exposes a Local App on a Public Hostname via Cloudflare Tunnel"
artifact_type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-007"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-038"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **platform engineer** running an app on my local kind cluster
(via `ix up`), I want to share that app with a teammate or stakeholder
on the public internet using a friendly hostname like
`cloud-manager.agent-ix.dev` — without exposing my LAN, without
restarting the cluster, and without per-app DNS or tunnel
configuration. When I'm done demoing I want to take it private again
just as quickly.

## Context

The flow rides on a shared Cloudflare Tunnel: cloudflared runs once
in the cluster, terminates a wildcard hostname (default
`*.agent-ix.dev`), and forwards by `Host` header to ingress-nginx.
Per-app exposure is just toggling the existing FR-037 multi-host
ingress on the entry subchart of a release — no per-app tunnel, no
per-app DNS record. Apps that aren't explicitly exposed remain
private (FR-037 security boundary).

### One-time setup (operator)

The operator does this once per Cloudflare account:

1. Create a tunnel in the Cloudflare dashboard (Zero Trust → Networks
   → Tunnels). Note the tunnel ID + token.
2. Add a wildcard CNAME in the `agent-ix.dev` zone:
   `*.agent-ix.dev → <tunnel-id>.cfargotunnel.com` (proxied).
3. Run `ix tunnel up`. The first run on a TTY prompts for the
   token (stored via SecretsService) and the base domain
   (persisted to `~/.config/ix/config.d/local.yaml`); subsequent
   runs skip the prompt and just reconcile the helm release.

For CI / scripted setup, the same can be done non-interactively:
```bash
export IX_CF_TUNNEL_TOKEN=…           # or: ix secrets set cloudflare-tunnel-token
ix tunnel domain agent-ix.dev          # or: ix config set local tunnel.baseDomain=agent-ix.dev
ix tunnel up
```

### Daily flow (operator)

```bash
ix up cloud-manager                    # local install, *.dev.ix only
ix tunnel expose cloud-manager         # add *.agent-ix.dev to the ingress
# … demo …
ix tunnel unexpose cloud-manager       # back to private
```

Or in a single step:
```bash
ix up cloud-manager --expose
```

`ix tunnel status` lists the tunnel pod state and every host
currently terminated under `*.<tunnel.baseDomain>`. `ix tunnel down`
stops the tunnel entirely (every exposed app goes dark at once).

### Cluster-restart behavior

When the cluster is paused/resumed (`ix cluster stop`/`start`):

- If `tunnel.autoStart=false` (default): cloudflared does not come
  back up; the operator runs `ix tunnel up` when they want it again.
- If `tunnel.autoStart=true`: `ix cluster start` brings cloudflared
  up after the API server is reachable, silently skipping when no
  token is resolvable. Cluster start NEVER blocks on stdin — the
  prompt-on-TTY behavior is scoped to explicit `ix tunnel up`.

Per-app exposure does NOT survive a `helm uninstall`. After
`ix halt cloud-manager && ix up cloud-manager` the app is private
again until the operator re-runs `ix tunnel expose cloud-manager`.

## Acceptance

- **US-011-AC-1**: First-run on a TTY: `ix tunnel up` with no token
  configured prompts for the token and the base domain, persists
  both, and brings cloudflared up. The next invocation runs without
  prompting.
- **US-011-AC-2**: Off-TTY (CI): `ix tunnel up` with no token
  configured exits non-zero with an actionable error pointing at
  `IX_CF_TUNNEL_TOKEN` and `ix secrets set cloudflare-tunnel-token`.
  Stdin is never read.
- **US-011-AC-3**: `ix tunnel domain` (no arg) prints the current
  `tunnel.baseDomain`. `ix tunnel domain <fqdn>` validates and
  persists; an invalid value (single label, whitespace) is rejected
  with a clear error and no write occurs.
- **US-011-AC-4**: After `ix up cloud-manager` and
  `ix tunnel expose cloud-manager`, the app's Ingress has rules for
  both `*.dev.ix` and `*.agent-ix.dev` (or whatever
  `tunnel.baseDomain` is set to), and the public URL returns the
  app's response from off-LAN.
- **US-011-AC-5**: `ix tunnel unexpose cloud-manager` removes the
  `*.<tunnel.baseDomain>` rule from the Ingress. The internal host
  (e.g. `cloud-manager-ui.dev.ix`) keeps working.
- **US-011-AC-6**: Exposing one app does NOT expose any other app —
  sibling subcharts in an umbrella release stay private even when
  `global.extraBaseDomains` contains the tunnel base domain.
- **US-011-AC-7**: `ix up cloud-manager --expose` performs the
  install AND the exposure in one step, equivalent to the two-
  command form. Skipped under `--from-source` (source mode is for
  dev loops, not external demos).
- **US-011-AC-8**: `ix tunnel status` reports the cloudflared pod
  phase and lists every host in the cluster whose Ingress rule ends
  with `.<tunnel.baseDomain>`.
- **US-011-AC-9**: With `tunnel.autoStart=true` and a resolvable
  token, `ix cluster start` brings cloudflared up after the API
  server is reachable; cluster start exits zero and never opens an
  interactive prompt. With `autoStart=false`, no tunnel-related
  output is produced.
- **US-011-AC-10**: An expired/revoked Cloudflare token does NOT
  break `ix cluster start` — the auto-start hook surfaces a
  warn-tail Listing and the cluster is reachable as usual.

## Test Coverage

| AC | Verified by |
|---|---|
| US-011-AC-1 | TC-432 (firstRunSetup TTY prompts + persists), TC-433 (idempotent on second invocation). |
| US-011-AC-2 | TC-430 (firstRunSetup non-TTY throws CI-safe error). |
| US-011-AC-3 | TC-434, TC-435 (setTunnelBaseDomain unit). TC-436 (`ix tunnel domain` integration) ❌ Missing. |
| US-011-AC-4 | TC-405–TC-409 (overlay merge + entry-subchart targeting). Live-cluster smoke ❌ Missing. |
| US-011-AC-5 | TC-410–TC-412 (unexpose overlay strips base domain + matching extraHosts). |
| US-011-AC-6 | TC-409, TC-412 (siblings absent from overlay; FR-037-CON-3 boundary preserved). |
| US-011-AC-7 | TC-424 (static: `--from-source --expose` does not run tunnel exposure). |
| US-011-AC-8 | Inherits FR-038-AC-12-style `getTunnelStatus` shape; live-cluster integration ❌ Missing. |
| US-011-AC-9 | TC-417 (autoStart=false skip), TC-418 (autoStart=true success), TC-419 (no-token warn-tail). |
| US-011-AC-10 | TC-420 (auto-start failure swallowed by cluster-start). |
