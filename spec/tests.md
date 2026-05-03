---
artifact_type: test-matrix
name: ix-cli / packages/local + packages/elements
---

# Test Matrix

## Overview

This matrix covers `packages/local` (`@agent-ix/ix-cli-local`), the package that
implements the migrated ix-local-cli command set inside the ix-cli monorepo.

Tests fall into four types:

| Type        | Description                                                              |
|-------------|--------------------------------------------------------------------------|
| Static      | Source-inspection tests (grep / readFileSync). Run under vitest.         |
| Unit        | Pure-function tests with no I/O. Run under vitest.                       |
| Integration | Require a live cluster or external process. Cannot run in unit context.  |
| Review      | Manual code inspection — no automated test possible.                     |

---

## Requirements Traceability

### Stakeholder Requirement Coverage

| Stakeholder Req | Trace to US/FR                       | Test/Validation                        | Coverage Status |
|-----------------|--------------------------------------|----------------------------------------|-----------------|
| StR-001         | US-001 → FR-001, FR-002, FR-003      | TC-001–TC-010 (static/unit)            | ✅ Partial (static + unit; integration pending) |
| StR-002         | US-002 → NFR-001, FR-002             | TC-007–TC-010 (static)                 | ✅ Partial (static; integration pending) |
| StR-003         | US-003/004/005 → FR-004–007, NFR-002 | TC-022–TC-043 (unit)                   | ✅ Complete (unit) |
| StR-004         | US-006 → FR-008, FR-009              | TC-022–TC-031 (unit)                   | ✅ Complete (unit) |

### User Story Coverage

| User Story | Acceptance Criteria | Test Cases | Coverage Status |
|------------|---------------------|------------|-----------------|
| US-001 | ix up/down/init/auth commands reachable | TC-001–TC-006 | ✅ Complete (static) |
| US-002 | Multi-service progress rendered via PhaseTable | TC-007, TC-010 | ✅ Complete (static) |
| US-003 | Cluster up: init + deploy ix-core services | TC-025–TC-031 | ✅ Complete (unit) |
| US-004 | Cluster down: confirmation guard, idempotent | TC-032–TC-038 | ✅ Complete (unit) |
| US-005 | Cluster status: node/pod health tables | TC-039–TC-043 | ✅ Complete (unit) |
| US-006 | ClusterConfig parsed from config.yaml | TC-022–TC-024 | ✅ Complete (unit) |

### Functional Requirement Coverage

| Functional Req | Acceptance Criteria | Test Cases | Coverage Status |
|----------------|---------------------|------------|-----------------|
| FR-001 | AC-1: all commands registered | TC-001–TC-006 | ✅ Complete (static) |
| FR-001 | AC-2: ix-local-cli FR-001–FR-020 satisfied | — | Review |
| FR-002 | AC-1: `ix up` uses PhaseTable from @agent-ix/ix-ui-cli | TC-010 | ✅ Complete (static) |
| FR-002 | AC-2: ix-local-cli FR-022 ACs satisfied via PhaseTable | — | Review |
| FR-002 | AC-3: no AppDisplay reference in src | TC-007 | ✅ Complete (static) |
| FR-002 | AC-4: Phase type defined only in phases.ts | TC-008, TC-009 | ✅ Complete (static) |
| FR-003 | AC-1: queued phase state when pool slot unavailable | — | ❌ Missing (integration) |
| FR-003 | AC-2: child failure does not abort sibling pipelines | — | ❌ Missing (integration) |
| FR-003 | AC-3: exit 0 on all success, exit 1 on any failure | — | ❌ Missing (integration) |
| FR-004 | AC-1: cluster subcommand group exports up/down/status | TC-007–TC-011 (static) | ✅ Complete (static) |
| FR-005 | AC-2–AC-6: computeEffectiveDeploySet algorithm | TC-025–TC-031 | ✅ Complete (unit) |
| FR-005 | AC-7: NFR-001 output compliance | TC-013 (static) | ✅ Complete (static) |
| FR-006 | AC-1: confirmation prompt shown without --yes | TC-038 | ✅ Complete (unit) |
| FR-006 | AC-2: decline/cancel exits 0 without delete | TC-033, TC-034 | ✅ Complete (unit) |
| FR-006 | AC-3: idempotent — absent cluster exits 0 | TC-035 | ✅ Complete (unit) |
| FR-006 | AC-4: only kind delete cluster spawned | TC-037 | ✅ Complete (unit) |
| FR-006 | AC-5: kind delete failure propagates | TC-036 | ✅ Complete (unit) |
| FR-007 | AC-1–AC-3: node table columns | TC-039 | ✅ Complete (unit) |
| FR-007 | AC-4: all healthy → outroSuccess only | TC-040 | ✅ Complete (unit) |
| FR-007 | AC-5: unhealthy pods → pod table | TC-041 | ✅ Complete (unit) |
| FR-007 | AC-6: kubectl failure throws descriptive error | TC-042 | ✅ Complete (unit) |
| FR-008 | AC-1–AC-4: ix-core tag inclusion/exclusion | TC-025, TC-026 | ✅ Complete (unit) |
| FR-009 | AC-1: absent file returns defaults | TC-022 | ✅ Complete (unit) |
| FR-009 | AC-2: valid cluster key parsed | TC-023 | ✅ Complete (unit) |
| FR-009 | AC-3: non-array throws ConfigValidationError | TC-024 | ✅ Complete (unit) |
| auth | ix-cli-auth-AC-1: no HTTP transport in `auth-init.ts` / `auth-reset-admin.ts` | TC-080 | ❌ Missing (static) |
| auth | ix-cli-auth-AC-2: `system`, `auth`, `platform`, `apps` namespaces all present after `ix up` | TC-081 | ❌ Missing (integration) |
| auth | ix-cli-auth-AC-3: bootstrap Secret at `system/admin-bootstrap` (not `auth/admin-bootstrap`) | TC-082 | ❌ Missing (integration) |
| auth | ix-cli-auth-AC-4: identity deployment in `auth` namespace | TC-083 | ❌ Missing (integration) |
| auth | ix-cli-auth-AC-5: `auth reset-user <admin>` surfaces clear "use reset-admin" message on 403 | TC-084 | ❌ Missing (integration) |
| auth | ix-cli-auth-AC-6: no namespace string literals in `packages/local/src` outside `config.ts` | TC-085 | ❌ Missing (static) |
| auth | ix-cli-auth-CON-1: `auth-init.ts` / `auth-reset-admin.ts` contain no `fetch`/`http`/`https`/`kubectlRaw`/`--raw` | TC-086 | ❌ Missing (static) |
| auth | ix-cli-auth-CON-2: `auth-secret.ts` writes Secret to `IX_SYSTEM_NAMESPACE` only | TC-087 | ❌ Missing (static + integration) |
| auth | ix-cli-auth-CON-3: all `kubectlRaw` calls target `IX_AUTH_NAMESPACE` | TC-088 | ❌ Missing (static) |
| auth | ix-cli-auth-CON-4: no namespace string literals (covered by TC-085) | TC-085 | ❌ Missing (static) |
| auth | ix-cli-auth-CON-5: Deployable registry — identity/auth-service/permission-service declare `namespace: IX_AUTH_NAMESPACE`; up-image/up-source honor `deployable.namespace` | TC-089 | ❌ Missing (integration) |

### Non-Functional Requirement Coverage

| Non-Functional Req | Verification Method | Evidence/Test Cases | Status |
|--------------------|---------------------|---------------------|--------|
| NFR-001-AC-1 | Static grep: no console.log/error/warn/process.stderr.write | TC-011, TC-012 | ✅ Complete (static) |
| NFR-001-AC-2 | Static grep: introCommand/outroSuccess/outroError imported from @agent-ix/ix-ui-cli in every command that calls them | TC-013 | ✅ Complete (static) |
| NFR-001-AC-3 | Static grep: PhaseTable imported from @agent-ix/ix-ui-cli | TC-010 | ✅ Complete (static) |
| NFR-002-AC-1 | Unit: prompt message contains cluster name | TC-038 | ✅ Complete (unit) |
| NFR-002-AC-2 | Unit: decline/cancel exits 0 without destructive action | TC-033, TC-034 | ✅ Complete (unit) |
| NFR-002-AC-3 | Unit: --yes bypasses prompt | TC-032 | ✅ Complete (unit) |

---

## Test Case Summary

| Test ID | Title | Type | Priority | Traces To | Status |
|---------|-------|------|----------|-----------|--------|
| TC-001 | index.ts exports runUp | Static | P1 | FR-001-AC-1 | ✅ Complete |
| TC-002 | index.ts exports runDown | Static | P1 | FR-001-AC-1 | ✅ Complete |
| TC-003 | index.ts exports runList | Static | P1 | FR-001-AC-1 | ✅ Complete |
| TC-004 | index.ts exports runAuthInit | Static | P1 | FR-001-AC-1 | ✅ Complete |
| TC-005 | index.ts exports runInitCluster | Static | P1 | FR-001-AC-1 | ✅ Complete |
| TC-006 | index.ts exports runAuthResetAdmin, runAuthInvite, runAuthResetUser | Static | P2 | FR-001-AC-1 | ✅ Complete |
| TC-007 | No AppDisplay reference in src | Static | P1 | FR-002-AC-3 | ✅ Complete |
| TC-008 | phases.ts exports Phase type | Static | P1 | FR-002-AC-4 | ✅ Complete |
| TC-009 | Phase type not declared outside phases.ts | Static | P1 | FR-002-AC-4 | ✅ Complete |
| TC-010 | PhaseTable imported from @agent-ix/ix-ui-cli, not a local file | Static | P1 | FR-002-AC-1, NFR-001-AC-3 | ✅ Complete |
| TC-011 | No console.log/error/warn/info calls in src | Static | P1 | NFR-001-AC-1 | ✅ Complete |
| TC-012 | No process.stderr.write calls in src | Static | P1 | NFR-001-AC-1 | ✅ Complete |
| TC-013 | Every command file using introCommand imports it from @agent-ix/ix-ui-cli | Static | P1 | NFR-001-AC-2 | ✅ Complete |
| TC-014 | queued phase state signalled when pool slot unavailable | Integration | P1 | FR-003-AC-1 | ❌ Missing |
| TC-015 | Child failure does not abort sibling concurrent pipelines | Integration | P1 | FR-003-AC-2 | ❌ Missing |
| TC-016 | Exit code 0 iff all children succeeded; exit 1 if any failed | Integration | P1 | FR-003-AC-3 | ❌ Missing |
| TC-017 | ix-local-cli FR-001–FR-020 ACs verified in implementation | Review | P2 | FR-001-AC-2 | Review |
| TC-018 | ix-local-cli FR-022 ACs satisfied via PhaseTable | Review | P2 | FR-002-AC-2 | Review |
| TC-007 | index.ts exports runClusterUp | Static | P1 | FR-004-AC-1 | ✅ Complete |
| TC-008 | index.ts exports computeEffectiveDeploySet | Static | P1 | FR-004-AC-1, FR-005 | ✅ Complete |
| TC-009 | index.ts exports runClusterDown | Static | P1 | FR-004-AC-1, FR-006 | ✅ Complete |
| TC-010 | index.ts exports runClusterStatus | Static | P1 | FR-004-AC-1, FR-007 | ✅ Complete |
| TC-011 | index.ts exports loadClusterConfig | Static | P1 | FR-004-AC-1, FR-009 | ✅ Complete |
| TC-022 | loadClusterConfig: absent file returns defaults | Unit | P1 | FR-009-AC-1 | ✅ Complete |
| TC-023 | loadClusterConfig: cluster key parsed correctly | Unit | P1 | FR-009-AC-2 | ✅ Complete |
| TC-024 | loadClusterConfig: non-array defaultTags throws ConfigValidationError | Unit | P1 | FR-009-AC-3 | ✅ Complete |
| TC-025 | computeEffectiveDeploySet: ix-core tagged apps included | Unit | P1 | FR-005-AC-2, FR-008-AC-1 | ✅ Complete |
| TC-026 | computeEffectiveDeploySet: non-tagged apps excluded | Unit | P1 | FR-005-AC-2, FR-008-AC-2 | ✅ Complete |
| TC-027 | computeEffectiveDeploySet: skipApps excludes tagged app | Unit | P1 | FR-005-AC-4 | ✅ Complete |
| TC-028 | computeEffectiveDeploySet: extraApps includes untagged app | Unit | P1 | FR-005-AC-3 | ✅ Complete |
| TC-029 | computeEffectiveDeploySet: deduplication — one app appears once | Unit | P1 | FR-005-AC-5 | ✅ Complete |
| TC-030 | computeEffectiveDeploySet: skipApps precedence over extraApps | Unit | P1 | FR-005-AC-4 | ✅ Complete |
| TC-031 | computeEffectiveDeploySet: deterministic output | Unit | P2 | FR-005-AC-6 | ✅ Complete |
| TC-032 | runClusterDown: --yes skips prompt, calls kind delete | Unit | P1 | FR-006-AC-2, NFR-002-AC-3 | ✅ Complete |
| TC-033 | runClusterDown: prompt returns false — no deletion | Unit | P1 | FR-006-AC-2, NFR-002-AC-2 | ✅ Complete |
| TC-034 | runClusterDown: prompt cancelled — no deletion | Unit | P1 | FR-006-AC-2, NFR-002-AC-2 | ✅ Complete |
| TC-035 | runClusterDown: absent cluster exits 0 | Unit | P1 | FR-006-AC-3 | ✅ Complete |
| TC-036 | runClusterDown: kind delete failure propagates | Unit | P1 | FR-006-AC-5 | ✅ Complete |
| TC-037 | runClusterDown: no helm uninstall called | Unit | P2 | FR-006-AC-4 | ✅ Complete |
| TC-038 | runClusterDown: prompt message contains cluster name | Unit | P1 | NFR-002-AC-1 | ✅ Complete |
| TC-039 | runClusterStatus: node table columns rendered | Unit | P1 | FR-007-AC-1–AC-3 | ✅ Complete |
| TC-040 | runClusterStatus: all healthy → outroSuccess only | Unit | P1 | FR-007-AC-4 | ✅ Complete |
| TC-041 | runClusterStatus: unhealthy pod → pod table shown | Unit | P1 | FR-007-AC-5 | ✅ Complete |
| TC-042 | runClusterStatus: kubectl failure throws descriptive error | Unit | P1 | FR-007-AC-6 | ✅ Complete |
| TC-043 | runClusterStatus: picocolors mock strips ANSI codes | Unit | P2 | FR-007-AC-7 | ✅ Complete |
| TC-080 | Static grep: `auth-init.ts` and `auth-reset-admin.ts` contain no `fetch\|http://\|https://\|kubectlRaw\|--raw` references | Static | P1 | ix-cli-auth-AC-1, ix-cli-auth-CON-1 | ❌ Missing |
| TC-081 | After `ix up`: `kubectl get ns system auth platform apps` returns all four | Integration | P1 | ix-cli-auth-AC-2 | ❌ Missing |
| TC-082 | After `ix local init`: `kubectl get secret admin-bootstrap -n system` succeeds; `-n auth` returns NotFound | Integration | P1 | ix-cli-auth-AC-3, ix-cli-auth-CON-2 | ❌ Missing |
| TC-083 | After `ix up`: `kubectl get deployment identity -n auth` returns the deployment | Integration | P1 | ix-cli-auth-AC-4, ix-cli-auth-CON-5 | ❌ Missing |
| TC-084 | `ix local auth reset-user <admin-email>` displays "use `ix local auth reset-admin`" guidance and exits non-zero | Integration | P1 | ix-cli-auth-AC-5 | ❌ Missing |
| TC-085 | Static grep: no namespace string literals (`"default"`, `"auth"`, `"system"`, `"platform"`, `"apps"`, `"ix-system"`) in `packages/local/src/` outside `config.ts` | Static | P1 | ix-cli-auth-AC-6, ix-cli-auth-CON-4 | ❌ Missing |
| TC-086 | Static grep: `auth-init.ts` only uses `kubectlExecJson`/`kubectl` shell-out; `auth-reset-admin.ts` likewise; neither imports `fetch`/`undici` | Static | P1 | ix-cli-auth-CON-1 | ❌ Missing |
| TC-087 | Static + integration: `auth-secret.ts` builds manifest with `metadata.namespace: ${IX_SYSTEM_NAMESPACE}`; applied Secret in `system`, never `auth` | Static + Integration | P1 | ix-cli-auth-CON-2 | ❌ Missing |
| TC-088 | Static grep: every `kubectlRaw(...)` invocation in `packages/local/src/commands/auth-*.ts` passes `IX_AUTH_NAMESPACE` (or equivalent constant) as the namespace argument | Static | P1 | ix-cli-auth-CON-3 | ❌ Missing |
| TC-089 | Integration: Deployable entries for `identity`, `auth-service`, `permission-service` declare `namespace: IX_AUTH_NAMESPACE`; helm releases land in `auth` after `ix up` | Integration | P1 | ix-cli-auth-CON-5 | ❌ Missing |

---

---

## packages/elements (`@agent-ix/ix-cli-elements`)

### Stakeholder Requirement Coverage

| Stakeholder Req | Trace to FR | Test Cases | Coverage Status |
|-----------------|-------------|------------|-----------------|
| StR-001 | FR-010, FR-011, FR-012 | TC-044–TC-075 | ✅ Partial (unit + static; integration pending) |

### Functional Requirement Coverage

| Functional Req | Acceptance Criteria | Test Cases | Coverage Status |
|----------------|---------------------|------------|-----------------|
| FR-010 | AC-1: groups by tap, root first | TC-071 | ✅ Complete (unit) |
| FR-010 | AC-2: shows name + description | TC-072 | ✅ Complete (unit) |
| FR-010 | AC-3: --refresh bypasses cache | TC-076 | ✅ Complete (unit) |
| FR-010 | AC-4: empty state message | TC-078 | ✅ Complete (unit) |
| FR-010 | AC-5: no console.log in command handler | TC-048 | ✅ Complete (static) |
| FR-011 | AC-1: unknown type throws helpful error | TC-075 | ✅ Complete (unit) |
| FR-011 | AC-2: clone/update to cache dir | — | ❌ Missing (integration) |
| FR-011 | AC-3: cookiecutter invocation | — | ❌ Missing (integration) |
| FR-011 | AC-4: git init + initial commit | — | ❌ Missing (integration) |
| FR-011 | AC-5: gh repo create --private | — | ❌ Missing (integration) |
| FR-011 | AC-6: --no-git / --no-github flags | — | ❌ Missing (integration) |
| FR-011 | AC-7: --org override | — | ❌ Missing (integration) |
| FR-012 | AC-1: tap add appends + invalidates cache | TC-059 | ✅ Complete (unit) |
| FR-012 | AC-2: duplicate tap is no-op | TC-060 | ✅ Complete (unit) |
| FR-012 | AC-3: URL format validation | TC-056–TC-058, TC-061 | ✅ Complete (unit) |
| FR-012 | AC-4: tap remove + invalidates cache | TC-062 | ✅ Complete (unit) |
| FR-012 | AC-5: remove root tap throws | TC-063 | ✅ Complete (unit) |
| FR-012 | AC-6: tap list marks root with (root) | TC-077 | ✅ Complete (unit) |
| FR-012 | AC-7: root tap always present | TC-064 | ✅ Complete (unit) |
| FR-013 | AC-1–AC-3: new element scaffolding | — | ❌ Missing (stub — pending meta-template) |
| FR-013 | AC-4: manual steps printed | — | Review |

### Non-Functional Requirement Coverage

| Non-Functional Req | Verification Method | Test Cases | Status |
|--------------------|---------------------|------------|--------|
| NFR-001-AC-1 | Static grep: no console.log/error/warn/info | TC-048 | ✅ Complete (static) |
| NFR-001-AC-1 | Static grep: no process.stderr.write | TC-049 | ✅ Complete (static) |
| NFR-001-AC-2 | Static grep: introCommand imported from @agent-ix/ix-ui-cli | TC-050 | ✅ Complete (static) |

### Test Case Summary — packages/elements

| Test ID | Title | Type | Priority | Traces To | Status |
|---------|-------|------|----------|-----------|--------|
| TC-044 | index.ts exports runElementsList | Static | P1 | FR-010 | ✅ Complete |
| TC-045 | index.ts exports runInit | Static | P1 | FR-011 | ✅ Complete |
| TC-046 | index.ts exports runElementsNew | Static | P1 | FR-013 | ✅ Complete |
| TC-047 | index.ts exports runTapAdd, runTapRemove, runTapList | Static | P1 | FR-012 | ✅ Complete |
| TC-048 | No console.log in src | Static | P1 | NFR-001-AC-1, FR-010-AC-5 | ✅ Complete |
| TC-049 | No process.stderr.write in src | Static | P1 | NFR-001-AC-1 | ✅ Complete |
| TC-050 | introCommand imported from @agent-ix/ix-ui-cli | Static | P1 | NFR-001-AC-2 | ✅ Complete |
| TC-051 | readCache returns null for cold cache | Unit | P1 | FR-010 | ✅ Complete |
| TC-052 | writeCache/readCache round-trips elements | Unit | P1 | FR-010 | ✅ Complete |
| TC-053 | readCache returns null and deletes file after TTL expiry | Unit | P1 | FR-010 | ✅ Complete |
| TC-054 | readCache returns null after explicit invalidation | Unit | P1 | FR-012-AC-1 | ✅ Complete |
| TC-055 | invalidateCache() clears all taps | Unit | P1 | FR-012-AC-1 | ✅ Complete |
| TC-056 | validateTapUrl accepts github.com/<org> | Unit | P1 | FR-012-AC-3 | ✅ Complete |
| TC-057 | validateTapUrl accepts github.com/<org>/<repo> | Unit | P1 | FR-012-AC-3 | ✅ Complete |
| TC-058 | validateTapUrl rejects invalid formats (bare domain, traversal, non-github) | Unit | P1 | FR-012-AC-3 | ✅ Complete |
| TC-059 | addTap returns true for new tap | Unit | P1 | FR-012-AC-1 | ✅ Complete |
| TC-060 | addTap returns false for duplicate | Unit | P1 | FR-012-AC-2 | ✅ Complete |
| TC-061 | addTap rejects invalid URL before writing config | Unit | P1 | FR-012-AC-3 | ✅ Complete |
| TC-062 | removeTap removes tap from config | Unit | P1 | FR-012-AC-4 | ✅ Complete |
| TC-063 | removeTap throws for root tap | Unit | P1 | FR-012-AC-5 | ✅ Complete |
| TC-064 | loadTapConfig always includes root tap | Unit | P1 | FR-012-AC-7 | ✅ Complete |
| TC-065 | parseFrontmatter extracts component_type + template_for | Unit | P1 | FR-010 | ✅ Complete |
| TC-066 | parseFrontmatter returns null for missing frontmatter | Unit | P1 | FR-010 | ✅ Complete |
| TC-067 | parseFrontmatter returns null for malformed YAML | Unit | P1 | FR-010 | ✅ Complete |
| TC-068 | toSlug: lowercases, spaces/underscores → hyphens | Unit | P1 | FR-011 | ✅ Complete |
| TC-069 | toSlug: strips path traversal (.., /, \) | Unit | P1 | FR-011 (security) | ✅ Complete |
| TC-070 | toSlug: strips non-alphanumeric chars | Unit | P1 | FR-011 (security) | ✅ Complete |
| TC-071 | resolveAllElements: cache hit — no GitHub fetch | Unit | P1 | FR-010-AC-3 | ✅ Complete |
| TC-072 | resolveAllElements: cache miss → index → writes cache | Unit | P1 | FR-010 | ✅ Complete |
| TC-073 | resolveAllElements: index null → falls back to topic search | Unit | P1 | FR-010 | ✅ Complete |
| TC-074 | resolveElementByType returns matching element | Unit | P1 | FR-011-AC-1 | ✅ Complete |
| TC-075 | resolveElementByType throws helpful error for unknown type | Unit | P1 | FR-011-AC-1 | ✅ Complete |
| TC-076 | resolveAllElements: refresh=true skips cache read | Unit | P1 | FR-010-AC-3 | ✅ Complete |
| TC-077 | runTapList: root tap entry contains "(root)", others do not | Unit | P1 | FR-012-AC-6 | ✅ Complete |
| TC-078 | runElementsList: empty result directs user to add a tap | Unit | P1 | FR-010-AC-4 | ✅ Complete |
| TC-090 | runUp options accept refresh boolean and pass it to source mode | Static | P1 | FR-030-AC-1, FR-030-AC-2 | ✅ Complete |
| TC-091 | UpFilterOptions declares refresh field | Static | P1 | FR-030-AC-2 | ✅ Complete |
| TC-092 | runSourceModeUp forces dependencyUpdate=true when refresh is set | Static | P1 | FR-030-AC-3 | ✅ Complete |
| TC-093 | up-image.ts builds umbrella install args; per-subchart helper removed | Static | P1 | FR-031-AC-1, FR-031-AC-2 | ✅ Complete |
| TC-094 | Umbrella path issues `helm pull` against the app OCI ref, not per-subchart | Static | P1 | FR-031-AC-2 | ✅ Complete |
| TC-095 | Rollout status appends settling marker when ready but not reconciled | Static | P1 | FR-031-AC-8 | ✅ Complete |
| TC-096 | runDown uninstalls the umbrella release first for role=app | Static | P1 | FR-031-AC-11 | ✅ Complete |
| TC-097 | runDown deduplicates releases via a seen set | Static | P1 | FR-031-AC-11 | ✅ Complete |
| TC-098 | local-secrets exports ensureGhcrCredsInNamespace producing dockerconfigjson | Static | P1 | FR-032-AC-1, FR-032-AC-2 | ✅ Complete |
| TC-099 | runImageModeUp calls ensureGhcrCredsInNamespace before helm install for every install ns | Static | P1 | FR-032-AC-3 | ✅ Complete |

---

## packages/core (`@agent-ix/ix-cli-core`) — Shared Config & Secrets

### Stakeholder Requirement Coverage

| Stakeholder Req | Trace to FR/NFR | Test Cases | Coverage Status |
|-----------------|-----------------|------------|-----------------|
| StR-005 | FR-010, FR-011, FR-012, FR-013, FR-018, FR-020 | TC-100–TC-124, TC-150–TC-156, TC-185, TC-187–TC-191 | 🚧 In Progress |
| StR-006 | FR-014, FR-015, FR-016, FR-017, FR-019, FR-020, NFR-003, NFR-004 | TC-125–TC-149, TC-157–TC-173, TC-184, TC-186 | 🚧 In Progress |

### Functional Requirement Coverage

| Functional Req | Acceptance Criteria | Test Cases | Coverage Status |
|----------------|---------------------|------------|-----------------|
| FR-010 | AC-1: forPlugin scopes reads to its own file | TC-100 | 🚧 In Progress (unit) |
| FR-010 | AC-2: atomic temp+rename write | TC-101 | 🚧 In Progress (unit) |
| FR-010 | AC-3: file mode 0o600 regardless of umask | TC-102 | 🚧 In Progress (unit) |
| FR-010 | AC-4: unknown key in strict schema → ConfigSchemaError | TC-103 | 🚧 In Progress (unit) |
| FR-010 | AC-5: reset() deletes file; defaults thereafter | TC-104 | 🚧 In Progress (unit) |
| FR-010 | AC-6: filePath() returns absolute path | TC-105 | 🚧 In Progress (unit) |
| FR-010 | AC-7: read-only target → ConfigWriteError; existing content intact | TC-192 | 🚧 In Progress (unit) |
| FR-010 | AC-8: temp file is sibling of target (not in os.tmpdir) | TC-193 | 🚧 In Progress (unit) |
| FR-010 | AC-9: orphan temp pruning on next set() (>30s old) | TC-194 | 🚧 In Progress (unit) |
| FR-011 | AC-1: malformed file in one plugin doesn't block another | TC-106 | 🚧 In Progress (unit) |
| FR-011 | AC-2: defaulted load → first set() rewrites file valid | TC-107 | 🚧 In Progress (unit) |
| FR-011 | AC-3: doctor() returns scoped errors, doesn't throw | TC-108 | 🚧 In Progress (unit) |
| FR-011 | AC-4: same-plugin concurrent writes serialized via lock | TC-109 | 🚧 In Progress (unit) |
| FR-011 | AC-5: different-plugin concurrent writes don't contend | TC-110 | 🚧 In Progress (unit) |
| FR-011 | AC-6: stale lock from non-running pid is reaped | TC-111 | 🚧 In Progress (unit) |
| FR-011 | AC-7: lock timeout → ConfigLockTimeoutError | TC-112 | 🚧 In Progress (unit) |
| FR-012 | AC-1: env var beats file value | TC-113 | 🚧 In Progress (unit) |
| FR-012 | AC-2: file value beats default | TC-114 | 🚧 In Progress (unit) |
| FR-012 | AC-3: defaults applied when env+file absent | TC-115 | 🚧 In Progress (unit) |
| FR-012 | AC-4: invalid env value → ConfigSchemaError | TC-116 | 🚧 In Progress (unit) |
| FR-012 | AC-5: static lint — no cross-plugin forPlugin call sites | TC-117 | 🚧 In Progress (static) |
| FR-012 | AC-6: post-migration hot path doesn't read legacy paths | TC-118 | 🚧 In Progress (static) |
| FR-013 | AC-1: configSchema enforced on writes | TC-119 | 🚧 In Progress (unit) |
| FR-013 | AC-2: non-strict schema → logged + skipped, others load | TC-120 | 🚧 In Progress (unit) |
| FR-013 | AC-3: duplicate id → second logged + skipped, first preserved | TC-121 | 🚧 In Progress (unit) |
| FR-013 | AC-4: third-party using "core" → logged + skipped, core preserved | TC-122 | 🚧 In Progress (unit) |
| FR-013 | AC-5: doctor surfaces failed plugin id, reason, source | TC-123 | 🚧 In Progress (unit) |
| FR-013 | AC-6: secretsSchema envVar honored ahead of backend | TC-124 | 🚧 In Progress (unit) |
| FR-013 | AC-7: invalid plugin id (regex violation) → log+skip with reason invalid-plugin-id | TC-195 | 🚧 In Progress (unit) |
| FR-014 | AC-1: env beats backend in get() | TC-125 | 🚧 In Progress (unit) |
| FR-014 | AC-2: backend value returned when env unset | TC-126 | 🚧 In Progress (unit) |
| FR-014 | AC-3: prompt path persists collected value | TC-127 | 🚧 In Progress (unit) |
| FR-014 | AC-4: no-prompt + non-TTY → null | TC-128 | 🚧 In Progress (unit) |
| FR-014 | AC-5: set then delete → which() == "unset" | TC-129 | 🚧 In Progress (unit) |
| FR-014 | AC-6: set on env-bound + env set → SecretBackendImmutableError | TC-130 | 🚧 In Progress (unit) |
| FR-014 | AC-7: zero secret values in any logged output | TC-131 | 🚧 In Progress (static) |
| FR-014 | AC-8: malformed SecretId → InvalidSecretIdError | TC-186 | 🚧 In Progress (unit) |
| FR-015 | AC-1: macOS Keychain round-trip | TC-132 | 🚧 In Progress (integration, GH Actions macos-latest) |
| FR-015 | AC-2: Linux libsecret round-trip | TC-133 | 🚧 In Progress (integration, GH Actions ubuntu-latest + gnome-keyring) |
| FR-015 | AC-3: dbus unset → backend becomes age-file | TC-134 | 🚧 In Progress (integration) |
| FR-015 | AC-4: list() filters to service "ix-cli" only | TC-135 | 🚧 In Progress (unit, mocked) |
| FR-015 | AC-5: denied prompt → KeyringAccessError with remediation | TC-136 | 🚧 In Progress (unit, mocked) |
| FR-015 | AC-6: probe runs at most once per process | TC-137 | 🚧 In Progress (unit) |
| FR-016 | AC-1: secrets.d/<id>.age + secrets.key created mode 0600 | TC-138 | 🚧 In Progress (unit) |
| FR-016 | AC-2a: blob bytes do not contain plaintext substring | TC-139 | 🚧 In Progress (unit) |
| FR-016 | AC-2b: secrets.key is exactly one AGE-SECRET-KEY-1… identity + \n | TC-184 | 🚧 In Progress (unit) |
| FR-016 | AC-3: AEAD-tag corruption isolates failure to one plugin | TC-140 | 🚧 In Progress (unit) |
| FR-016 | AC-4: every write produces 0o600 post-rename | TC-141 | 🚧 In Progress (unit) |
| FR-016 | AC-5: wide-perm secrets.key → SecretsIdentityPermissionsError | TC-142 | 🚧 In Progress (unit) |
| FR-016 | AC-6: zero plaintext leaks across full lifecycle | TC-143 | 🚧 In Progress (unit) |
| FR-017 | AC-1: full migration cycle (config + creds → new stores) | TC-144 | 🚧 In Progress (integration) |
| FR-017 | AC-2: idempotent — second run no-op | TC-145 | 🚧 In Progress (unit) |
| FR-017 | AC-3: malformed legacy aborts; legacy preserved | TC-146 | 🚧 In Progress (unit) |
| FR-017 | AC-4: no legacy → silent no-op | TC-147 | 🚧 In Progress (unit) |
| FR-017 | AC-5: post-migration grep for legacy paths | TC-148 | 🚧 In Progress (static) |
| FR-017 | AC-6: migrated GHCR token never lands in plaintext file | TC-149 | 🚧 In Progress (unit) |
| FR-018 | AC-1: get omits plugin → defaults to "core" | TC-150 | 🚧 In Progress (unit) |
| FR-018 | AC-2: set persists; next ix local up observes value | TC-151 | 🚧 In Progress (integration) |
| FR-018 | AC-3: invalid set surfaces full four-tuple error | TC-152 | 🚧 In Progress (unit) |
| FR-018 | AC-4: edit re-prompts on validation failure | TC-153 | 🚧 In Progress (unit) |
| FR-018 | AC-5: doctor with mixed valid/invalid files exits non-zero | TC-154 | 🚧 In Progress (unit) |
| FR-018 | AC-6: unknown plugin → UnknownPluginError + list of ids | TC-155 | 🚧 In Progress (unit) |
| FR-018 | AC-7: concurrent set serialized via per-file lock | TC-156 | 🚧 In Progress (unit) |
| FR-018 | AC-8: non-JSON for array key → ConfigSetParseError | TC-185 | 🚧 In Progress (unit) |
| FR-019 | AC-1: list never renders secret values | TC-157 | 🚧 In Progress (static + unit) |
| FR-019 | AC-2: set prints "stored <id> in <backend>" only | TC-158 | 🚧 In Progress (unit) |
| FR-019 | AC-3: which transitions: env / keyring / unset | TC-159 | 🚧 In Progress (unit) |
| FR-019 | AC-4: rm clears persisted value; warns if env set | TC-160 | 🚧 In Progress (unit) |
| FR-019 | AC-5: unknown id → UnknownSecretError | TC-161 | 🚧 In Progress (unit) |
| FR-019 | AC-6: zero secret values across lifecycle stdout/stderr | TC-162 | 🚧 In Progress (unit) |
| FR-019 | AC-7: keyring denial → remediation surfaced; not echoed | TC-163 | 🚧 In Progress (unit) |
| FR-020 | AC-1: empty env+file → full default object | TC-187 | 🚧 In Progress (unit) |
| FR-020 | AC-2: every leaf env binding takes precedence over file | TC-188 | 🚧 In Progress (unit) |
| FR-020 | AC-3: secretsBackend=auto switches by probe outcome | TC-189 | 🚧 In Progress (unit) |
| FR-020 | AC-4: secretsBackend=keyring + probe fail → KeyringUnavailableError | TC-183 | 🚧 In Progress (unit) |
| FR-020 | AC-5: unknown key (e.g. cluster.context) on core → strict reject | TC-190 | 🚧 In Progress (unit) |
| FR-020 | AC-6: every declared SecretId registered + envVar honored | TC-191 | 🚧 In Progress (unit) |
| FR-020 | AC-7: auth.expiresAt has no env binding (no IX_AUTH_EXPIRES_AT effect) | TC-191 | 🚧 In Progress (unit) |

### Non-Functional Requirement Coverage

| Non-Functional Req | Verification Method | Test Cases | Status |
|--------------------|---------------------|------------|--------|
| NFR-003-AC-1 | Static grep: no fs.write* of secret values outside backends/ | TC-164 | 🚧 In Progress (static) |
| NFR-003-AC-2 | Round-trip leak scan: plaintext absent from .age + .key | TC-165 | 🚧 In Progress (unit) |
| NFR-003-AC-3 | Integration: only-keychain or only-age-blob on disk | TC-166 | 🚧 In Progress (integration) |
| NFR-003-AC-4 | Integration: legacy credentials.json absent post-migration | TC-167 | 🚧 In Progress (integration) |
| NFR-003-AC-5 | Static grep: no new readers of credentials.json outside migration/ | TC-168 | 🚧 In Progress (static) |
| NFR-004-AC-1 | Unit: umask 0022 yields 0o600 | TC-169 | 🚧 In Progress (unit) |
| NFR-004-AC-2 | Unit: rename failure leaves target intact, temp removed | TC-170 | 🚧 In Progress (unit) |
| NFR-004-AC-3 | Unit: 0o644 secrets.key → SecretsIdentityPermissionsError | TC-171 | 🚧 In Progress (unit) |
| NFR-004-AC-4 | Unit: symlink to outside path rejected | TC-172 | 🚧 In Progress (unit) |
| NFR-004-AC-5 | Static grep: only atomicWrite helper writes governed files | TC-173 | 🚧 In Progress (static) |
| NFR-005-AC-1 | Unit: error contains plugin / keyPath / expectedType / filePath | TC-174 | 🚧 In Progress (unit) |
| NFR-005-AC-2 | Unit: declared-secret value rendered as `<redacted>` | TC-175 | 🚧 In Progress (unit) |
| NFR-005-AC-3 | Snapshot: doctor output stable order | TC-176 | 🚧 In Progress (unit) |
| NFR-005-AC-4 | Static grep: no console.error for schema errors | TC-177 | 🚧 In Progress (static) |
| NFR-005-AC-5 | Static grep: only formatSchemaError renders user strings | TC-178 | 🚧 In Progress (static) |
| NFR-006-AC-1 | Unit: MemoryBackend registered + full lifecycle | TC-179 | 🚧 In Progress (unit) |
| NFR-006-AC-2 | Unit: consumers unchanged across keyring↔age-file | TC-180 | 🚧 In Progress (unit) |
| NFR-006-AC-3 | Static grep: no consumer imports backends/* | TC-181 | 🚧 In Progress (static) |
| NFR-006-AC-4 | Unit: duplicate-id registration throws | TC-182 | 🚧 In Progress (unit) |
| NFR-006-AC-5 | Unit: pinned keyring with failed probe → KeyringUnavailableError | TC-183 | 🚧 In Progress (unit) |

### Test Case Summary — packages/core

| Test ID | Title | Type | Priority | Traces To | Status |
|---------|-------|------|----------|-----------|--------|
| TC-100 | ConfigService.forPlugin('a') reads only config.d/a.yaml | Unit | P1 | FR-010-AC-1 | 🚧 In Progress |
| TC-101 | set() uses temp+rename; interrupted write leaves prior content | Unit | P1 | FR-010-AC-2 | 🚧 In Progress |
| TC-102 | set() forces 0o600 under umask 0022 | Unit | P1 | FR-010-AC-3, NFR-004-AC-1 | 🚧 In Progress |
| TC-103 | strict schema rejects unknownKey on set() | Unit | P1 | FR-010-AC-4, FR-013-AC-1 | 🚧 In Progress |
| TC-104 | reset() deletes file; subsequent get() returns defaults | Unit | P1 | FR-010-AC-5 | 🚧 In Progress |
| TC-105 | filePath() returns absolute path under XDG_CONFIG_HOME | Unit | P2 | FR-010-AC-6 | 🚧 In Progress |
| TC-106 | Malformed config.d/local.yaml: elements load succeeds | Unit | P1 | FR-011-AC-1, StR-005 | 🚧 In Progress |
| TC-107 | Defaulted load + first set rewrites valid YAML | Unit | P1 | FR-011-AC-2 | 🚧 In Progress |
| TC-108 | doctor() aggregates errors per plugin without throwing | Unit | P1 | FR-011-AC-3, FR-018-AC-5 | 🚧 In Progress |
| TC-109 | Concurrent set on same plugin serialized via lockfile | Unit | P1 | FR-011-AC-4, FR-018-AC-7 | 🚧 In Progress |
| TC-110 | Concurrent set on different plugins both succeed | Unit | P1 | FR-011-AC-5 | 🚧 In Progress |
| TC-111 | Stale lockfile (pid not running) reaped on next acquisition | Unit | P1 | FR-011-AC-6 | 🚧 In Progress |
| TC-112 | Lock timeout → ConfigLockTimeoutError names plugin and lockfile | Unit | P1 | FR-011-AC-7 | 🚧 In Progress |
| TC-113 | IX_LOG_LEVEL=debug + file=info → resolved=debug | Unit | P1 | FR-012-AC-1 | 🚧 In Progress |
| TC-114 | Env unset + file=info → resolved=info | Unit | P1 | FR-012-AC-2 | 🚧 In Progress |
| TC-115 | Env+file absent → schema defaults | Unit | P1 | FR-012-AC-3 | 🚧 In Progress |
| TC-116 | IX_LOG_LEVEL=loud (invalid enum) → ConfigSchemaError naming env var | Unit | P1 | FR-012-AC-4 | 🚧 In Progress |
| TC-117 | Non-core plugin attempting to write core file → rejected | Unit | P1 | FR-012-AC-5, FR-013-AC-4 | 🚧 In Progress |
| TC-118 | Static grep: no readers of ~/.ix/config.yaml outside migration/ | Static | P1 | FR-012-AC-6, FR-017-AC-5 | 🚧 In Progress |
| TC-119 | Plugin with strict configSchema validates writes | Unit | P1 | FR-013-AC-1 | 🚧 In Progress |
| TC-120 | Non-strict schema (.passthrough) → PluginRegistrationError | Unit | P1 | FR-013-AC-2 | 🚧 In Progress |
| TC-121 | Duplicate plugin id → second registration throws | Unit | P1 | FR-013-AC-3 | 🚧 In Progress |
| TC-122 | Third-party plugin using id "core" → rejected | Unit | P1 | FR-013-AC-4 | 🚧 In Progress |
| TC-123 | Plugin registration failure: other plugins still load; doctor reports | Unit | P1 | FR-013-AC-5 | 🚧 In Progress |
| TC-124 | secretsSchema envVar honored ahead of any backend | Unit | P1 | FR-013-AC-6, FR-014-AC-1 | 🚧 In Progress |
| TC-125 | get(): IX_GHCR_TOKEN beats backend value | Unit | P1 | FR-014-AC-1 | 🚧 In Progress |
| TC-126 | get(): backend value returned when env unset | Unit | P1 | FR-014-AC-2 | 🚧 In Progress |
| TC-127 | get({prompt:true}) on TTY: masked input persisted to backend | Unit | P1 | FR-014-AC-3 | 🚧 In Progress |
| TC-128 | get() without prompt and unset → null (no prompt) | Unit | P1 | FR-014-AC-4 | 🚧 In Progress |
| TC-129 | set then delete → which() === "unset" | Unit | P1 | FR-014-AC-5 | 🚧 In Progress |
| TC-130 | set() on env-bound secret with env set → SecretBackendImmutableError | Unit | P1 | FR-014-AC-6 | 🚧 In Progress |
| TC-131 | Static + log scan: zero secret values across SecretsService output | Static | P1 | FR-014-AC-7, NFR-005-AC-2 | 🚧 In Progress |
| TC-132 | macOS Keychain set/get round-trip | Integration | P1 | FR-015-AC-1 | ❌ Missing |
| TC-133 | Linux libsecret set/get round-trip | Integration | P1 | FR-015-AC-2 | ❌ Missing |
| TC-134 | DBUS_SESSION_BUS_ADDRESS unset → active backend = age-file | Integration | P1 | FR-015-AC-3, FR-016-AC-1 | 🚧 In Progress |
| TC-135 | list() filters to service="ix-cli"; foreign entries ignored | Unit | P1 | FR-015-AC-4 | 🚧 In Progress |
| TC-136 | Denied keyring prompt → KeyringAccessError with remediation | Unit | P1 | FR-015-AC-5 | 🚧 In Progress |
| TC-137 | Capability probe cached: runs once per process | Unit | P2 | FR-015-AC-6 | 🚧 In Progress |
| TC-138 | secrets.d/<id>.age + secrets.key created with mode 0o600 | Unit | P1 | FR-016-AC-1, NFR-004-AC-1 | 🚧 In Progress |
| TC-139 | age blob bytes do not contain plaintext value | Unit | P1 | FR-016-AC-2, NFR-003-AC-2 | 🚧 In Progress |
| TC-140 | Truncated secrets.d/local.age → local.* fails; elements.* still works | Unit | P1 | FR-016-AC-3 | 🚧 In Progress |
| TC-141 | All age writes observe 0o600 post-rename | Unit | P2 | FR-016-AC-4 | 🚧 In Progress |
| TC-142 | secrets.key with mode 0o644 → SecretsIdentityPermissionsError | Unit | P1 | FR-016-AC-5, NFR-004-AC-3 | 🚧 In Progress |
| TC-143 | Full set/get/delete lifecycle: zero plaintext leaks in age files | Unit | P1 | FR-016-AC-6, NFR-003-AC-2 | 🚧 In Progress |
| TC-144 | Migration: legacy creds + ~/.ix/config.yaml → new stores; legacy removed | Integration | P1 | FR-017-AC-1 | 🚧 In Progress |
| TC-145 | Migration idempotent: second run no-op; legacy not re-read | Unit | P1 | FR-017-AC-2 | 🚧 In Progress |
| TC-146 | Malformed legacy aborts migration; legacy files preserved | Unit | P1 | FR-017-AC-3 | 🚧 In Progress |
| TC-147 | No legacy present → migration silent no-op | Unit | P1 | FR-017-AC-4 | 🚧 In Progress |
| TC-148 | Static grep: ~/.ix/config.yaml + credentials.json only in migration/ | Static | P1 | FR-017-AC-5, NFR-003-AC-5 | 🚧 In Progress |
| TC-149 | Migrated GHCR token: zero plaintext on disk after migration | Unit | P1 | FR-017-AC-6 | 🚧 In Progress |
| TC-150 | ix config get logLevel → reads core plugin config | Unit | P1 | FR-018-AC-1 | 🚧 In Progress |
| TC-151 | ix config set local cluster.defaultTags → next ix local up observes | Integration | P1 | FR-018-AC-2 | 🚧 In Progress |
| TC-152 | ix config set local cluster.defaultTags 42 → four-tuple error | Unit | P1 | FR-018-AC-3, NFR-005-AC-1 | 🚧 In Progress |
| TC-153 | ix config edit: bad save → re-edit/discard prompt | Unit | P1 | FR-018-AC-4 | 🚧 In Progress |
| TC-154 | ix config doctor: mixed valid/invalid → non-zero exit | Unit | P1 | FR-018-AC-5 | 🚧 In Progress |
| TC-155 | ix config get unknown-plugin foo → UnknownPluginError lists ids | Unit | P1 | FR-018-AC-6 | 🚧 In Progress |
| TC-156 | Concurrent ix config set local … both succeed serialized | Unit | P1 | FR-018-AC-7, FR-011-AC-4 | 🚧 In Progress |
| TC-157 | ix secrets list: value column never populated | Static + Unit | P1 | FR-019-AC-1, FR-014-AC-7 | 🚧 In Progress |
| TC-158 | ix secrets set local.ghcr-token: prints "stored ... in <backend>" only | Unit | P1 | FR-019-AC-2 | 🚧 In Progress |
| TC-159 | ix secrets which transitions: keyring → unset → env | Unit | P1 | FR-019-AC-3 | 🚧 In Progress |
| TC-160 | ix secrets rm: clears persisted; warns when env still satisfies | Unit | P1 | FR-019-AC-4 | 🚧 In Progress |
| TC-161 | ix secrets which unknown.foo → UnknownSecretError lists registered | Unit | P1 | FR-019-AC-5 | 🚧 In Progress |
| TC-162 | Lifecycle output scan: zero secret values in stdout/stderr | Unit | P1 | FR-019-AC-6, NFR-003-AC-2 | 🚧 In Progress |
| TC-163 | Keyring denial during set: remediation surfaced; value not echoed | Unit | P1 | FR-019-AC-7, FR-015-AC-5 | 🚧 In Progress |
| TC-164 | Static: no fs.write* of secret values outside backends/ | Static | P1 | NFR-003-AC-1 | 🚧 In Progress |
| TC-165 | Round-trip leak scan: ciphertext does not contain plaintext | Unit | P1 | NFR-003-AC-2 | 🚧 In Progress |
| TC-166 | Integration: only keychain entry OR age blob on disk; never both | Integration | P1 | NFR-003-AC-3 | 🚧 In Progress |
| TC-167 | Integration: legacy credentials.json absent after migration | Integration | P1 | NFR-003-AC-4, FR-017-AC-1 | 🚧 In Progress |
| TC-168 | Static: no new readers of credentials.json outside migration/ | Static | P1 | NFR-003-AC-5 | 🚧 In Progress |
| TC-169 | umask 0022 → governed files created mode 0o600 | Unit | P1 | NFR-004-AC-1 | 🚧 In Progress |
| TC-170 | rename failure: target intact + temp removed | Unit | P1 | NFR-004-AC-2 | 🚧 In Progress |
| TC-171 | secrets.key with mode 0o644 (fixture) → SecretsIdentityPermissionsError | Unit | P1 | NFR-004-AC-3, FR-016-AC-5 | 🚧 In Progress |
| TC-172 | Symlinked governed file rejected on access | Unit | P1 | NFR-004-AC-4 | 🚧 In Progress |
| TC-173 | Static: only atomicWrite helper writes governed files | Static | P1 | NFR-004-AC-5 | 🚧 In Progress |
| TC-174 | Schema error contains plugin/keyPath/expectedType/filePath | Unit | P1 | NFR-005-AC-1, FR-018-AC-3 | 🚧 In Progress |
| TC-175 | Declared-secret value redacted in error output | Unit | P1 | NFR-005-AC-2 | 🚧 In Progress |
| TC-176 | doctor output stable byte-order across runs | Unit | P2 | NFR-005-AC-3 | 🚧 In Progress |
| TC-177 | Static: zero console.error for schema errors | Static | P1 | NFR-005-AC-4 | 🚧 In Progress |
| TC-178 | Static: only formatSchemaError builds user-facing strings | Static | P1 | NFR-005-AC-5 | 🚧 In Progress |
| TC-179 | MemoryBackend registered: full lifecycle exercises SecretsService unchanged | Unit | P1 | NFR-006-AC-1 | 🚧 In Progress |
| TC-180 | Consumers compile/pass under both keyring and age-file backends | Unit | P1 | NFR-006-AC-2 | 🚧 In Progress |
| TC-181 | Static: zero imports of backends/* outside core/secrets/ | Static | P1 | NFR-006-AC-3 | 🚧 In Progress |
| TC-182 | registerSecretsBackend: duplicate id throws on second registration | Unit | P2 | NFR-006-AC-4 | 🚧 In Progress |
| TC-183 | core.secretsBackend=keyring + probe fail → KeyringUnavailableError everywhere | Unit | P1 | NFR-006-AC-5, FR-020-AC-4 | 🚧 In Progress |
| TC-184 | secrets.key is exactly one AGE-SECRET-KEY-1… identity + single \n | Unit | P1 | FR-016-AC-2b | 🚧 In Progress |
| TC-185 | ix config set local cluster.defaultTags 'a,b' (non-JSON) → ConfigSetParseError | Unit | P1 | FR-018-AC-8 | 🚧 In Progress |
| TC-186 | get/set/delete with malformed SecretId throws InvalidSecretIdError | Unit | P1 | FR-014-AC-8 | 🚧 In Progress |
| TC-187 | forPlugin('core', CoreConfigSchema).get() with empty env+file → full default object | Unit | P1 | FR-020-AC-1 | 🚧 In Progress |
| TC-188 | Each declared env binding (IX_LOG_LEVEL, IX_THEME, …) overrides file value | Unit | P1 | FR-020-AC-2 | 🚧 In Progress |
| TC-189 | secretsBackend=auto: keyring on probe-success; age-file on probe-fail | Unit | P1 | FR-020-AC-3 | 🚧 In Progress |
| TC-190 | Setting cluster.context on core file → strict reject (belongs to local) | Unit | P1 | FR-020-AC-5 | 🚧 In Progress |
| TC-191 | Each core SecretId registered with envVar precedence; auth.expiresAt has no env effect | Unit | P1 | FR-020-AC-6, FR-020-AC-7 | 🚧 In Progress |
| TC-192 | Read-only ~/.config/ix/ → set() throws ConfigWriteError; prior content intact; no orphan temp | Unit | P1 | FR-010-AC-7 | 🚧 In Progress |
| TC-193 | Mocked os.tmpdir() to a different volume — no governed-file write touches it | Unit | P1 | FR-010-AC-8 | 🚧 In Progress |
| TC-194 | Pre-existing <target>.tmp.* sibling >30s old is pruned on next set(); younger orphans left | Unit | P1 | FR-010-AC-9 | 🚧 In Progress |
| TC-195 | Plugin id "../foo" or "" or "Foo" → log+skip with reason "invalid-plugin-id"; doctor reports | Unit | P1 | FR-013-AC-7 | 🚧 In Progress |

---

## Edge Cases

- **`all` + named services**: `executeLocals` must throw on mixed invocation (FR-M6). Covered by TC-001 (export) — behavior tested implicitly via unit inspection of `index.ts`.
- **`all` without `--from-source`** in image mode: `runUp` must throw "all requires --from-source". Verifiable as a pure unit test but not listed above — candidate for a future TC-019.
- **Empty app deps**: `runImageModeUp` throws when `expandApp` returns `[]` (FR-013-AC-6). Candidate for TC-020 (unit with stubbed expander).
- **Phase type duplication**: `PHASES` constant defined alongside `Phase` type in `phases.ts`; TC-008/TC-009 guard against accidental re-declaration in other files.
