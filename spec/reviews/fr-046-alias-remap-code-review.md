---
id: REV-002
title: "Code review — ix-cli-auth-* alias ids replaced with FR-046-* (3fd60d7, #21)"
type: SpecReview
analysis: code-review
scope: "spec/tests.md, spec/functional/local/FR-044-auth-kubeconfig-issue.md, spec/functional/local/auth.md (FR-046), packages/local/tests/auth-static-checks.test.ts"
review_set: subset
---

# REV-002: Code review — FR-046 alias remap (3fd60d7, #21)

## Summary

Pre-release review of the unreviewed fix commit `3fd60d7` (ten
`ix-cli-auth-*` alias ids in spec/tests.md Traces To cells remapped to
canonical `FR-046-*`, one prose reference in FR-044-AC-10, closes #21). All
ten remapped cells were checked against FR-046's AC/CON tables in
`spec/functional/local/auth.md` — every mapping is 1:1 truthful. One medium
defect found and fixed in this pass: the sweep stopped at the spec tree,
leaving eight stale `ix-cli-auth-*` trace tags in the static-check test
file, ids the spec no longer defines anywhere.

## Verdict

**CONDITIONAL** — one medium finding (fixed in this pass), one low
pre-existing observation.

## Findings

| ID      | Severity | Summary                                                                                                                                                                                                             | Refs                                                  |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| FND-001 | medium   | Alias retirement swept spec/ only: `packages/local/tests/auth-static-checks.test.ts` still carried `ix-cli-auth-AC-1/AC-6/CON-1/CON-2/CON-3/CON-4` in describe titles and trace comments — dangling references to ids defined nowhere after #21. FIXED: renamed to `FR-046-*`; repo-wide grep now finds zero `ix-cli-auth-` references; suite green (330 passed packages/local) | packages/local/tests/auth-static-checks.test.ts:49,56,83,89,149,155,167,173 |
| FND-002 | low      | The FR-046/CON-2 AC-rollup row keeps `⚠️ Partial` — one of the five markers in rollup tables without `column_patterns` disclosed in PR #20 and deliberately untouched by 3fd60d7; unenforced vocabulary residue remains until those tables gain asserts | spec/tests.md:108                                     |

## Remap truthfulness (all ten cells checked; brief asked for four)

| TC row | Traces To (after) | FR-046 source line says | Truthful? |
| ------ | ----------------- | ----------------------- | --------- |
| TC-080 | FR-046-AC-1, FR-046-CON-1 | AC-1: source review finds no HTTP transport in `auth-init.ts`/`auth-reset-admin.ts`; CON-1: no `fetch`/`kubectlRaw`/`http`/`https` transport | yes |
| TC-081 | FR-046-AC-2 | AC-2: `kubectl get ns system auth platform apps` shows all four after `ix up` | yes |
| TC-082 | FR-046-AC-3, FR-046-CON-2 | AC-3: bootstrap Secret at `system/admin-bootstrap`, not `auth/`; CON-2: `auth-secret.ts` writes to `IX_SYSTEM_NAMESPACE` | yes |
| TC-083 | FR-046-AC-4, FR-046-CON-5 | AC-4: identity deployment in `auth`; CON-5: Deployable registry namespaces | yes |
| TC-084 | FR-046-AC-5 | AC-5: reset-user surfaces "use reset-admin" guidance | yes |
| TC-085 | FR-046-AC-6, FR-046-CON-4 | AC-6/CON-4: no namespace string literals outside `config.ts` | yes |
| TC-086 | FR-046-CON-1 | CON-1: no networked transport in admin commands | yes |
| TC-087 | FR-046-CON-2 | CON-2: bootstrap Secret namespace | yes |
| TC-088 | FR-046-CON-3 | CON-3: `kubectlRaw` targets `IX_AUTH_NAMESPACE` | yes |
| TC-089 | FR-046-CON-5 | CON-5: Deployable registry / helm namespace honor | yes |

The FR-044-AC-10 prose reference (`ix-cli-auth-CON-1` → `FR-046-CON-1`) also
points at the item carrying the identical no-HTTP-transport posture.

## Gap analysis — does #21's acceptance hold?

| Acceptance claim                                             | Holds? | Evidence                                                            |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| `quire validate spec/tests.md` exits 0                        | yes    | re-run at review time, exit 0                                       |
| Every alias maps 1:1 to its canonical FR-046 id, no meaning lost | yes  | table above; AC/CON text identity confirmed against auth.md         |
| Ten Traces To cells + AC rollup rows + one prose ref updated  | yes    | commit diff covers exactly these; nothing else touched              |
| Five disclosed PR #20 warning markers untouched               | yes    | still present, still in tables without column_patterns (FND-002)    |
| No `ix-cli-auth-*` ids remain in the repo                     | now    | held for spec/ only at commit time; FND-001 fix completes the sweep |
