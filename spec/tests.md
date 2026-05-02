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

---

## Edge Cases

- **`all` + named services**: `executeLocals` must throw on mixed invocation (FR-M6). Covered by TC-001 (export) — behavior tested implicitly via unit inspection of `index.ts`.
- **`all` without `--from-source`** in image mode: `runUp` must throw "all requires --from-source". Verifiable as a pure unit test but not listed above — candidate for a future TC-019.
- **Empty app deps**: `runImageModeUp` throws when `expandApp` returns `[]` (FR-013-AC-6). Candidate for TC-020 (unit with stubbed expander).
- **Phase type duplication**: `PHASES` constant defined alongside `Phase` type in `phases.ts`; TC-008/TC-009 guard against accidental re-declaration in other files.
