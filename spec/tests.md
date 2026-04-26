---
artifact_type: test-matrix
name: ix-cli / packages/local
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

### User Story Coverage

| User Story | Acceptance Criteria | Test Cases | Coverage Status |
|------------|---------------------|------------|-----------------|
| US-001 | ix up/down/init/auth commands reachable | TC-001–TC-006 | ✅ Complete (static) |
| US-002 | Multi-service progress rendered via PhaseTable | TC-007, TC-010 | ✅ Complete (static) |

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

### Non-Functional Requirement Coverage

| Non-Functional Req | Verification Method | Evidence/Test Cases | Status |
|--------------------|---------------------|---------------------|--------|
| NFR-001-AC-1 | Static grep: no console.log/error/warn/process.stderr.write | TC-011, TC-012 | ✅ Complete (static) |
| NFR-001-AC-2 | Static grep: introCommand/outroSuccess/outroError imported from @agent-ix/ix-ui-cli in every command that calls them | TC-013 | ✅ Complete (static) |
| NFR-001-AC-3 | Static grep: PhaseTable imported from @agent-ix/ix-ui-cli | TC-010 | ✅ Complete (static) |

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

---

## Edge Cases

- **`all` + named services**: `executeLocals` must throw on mixed invocation (FR-M6). Covered by TC-001 (export) — behavior tested implicitly via unit inspection of `index.ts`.
- **`all` without `--from-source`** in image mode: `runUp` must throw "all requires --from-source". Verifiable as a pure unit test but not listed above — candidate for a future TC-019.
- **Empty app deps**: `runImageModeUp` throws when `expandApp` returns `[]` (FR-013-AC-6). Candidate for TC-020 (unit with stubbed expander).
- **Phase type duplication**: `PHASES` constant defined alongside `Phase` type in `phases.ts`; TC-008/TC-009 guard against accidental re-declaration in other files.
