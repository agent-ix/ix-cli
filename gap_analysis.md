# Implementation Gap Analysis — packages/elements

**Date:** 2026-04-25
**Scope:** `packages/elements` (`@agent-ix/ix-cli-elements`)
**Retro archive:** `~/dev/retros/ix-cli/retro/elements-2026-04-25/accepted_proposals.md`

---

## Coverage Summary

| Category                          | Total       | Covered | Gaps | Coverage |
| --------------------------------- | ----------- | ------- | ---- | -------- |
| Stakeholder Requirements (StR)    | 1           | 1       | 0    | 100%     |
| Functional Requirements (FR)      | 4           | 4       | 0    | 100%     |
| Non-Functional Requirements (NFR) | 1 (NFR-001) | 1       | 0    | 100%     |
| Acceptance Criteria (AC)          | 29          | 22      | 7    | 76%      |
| Implicit Constraints (discovered) | 10          | 0       | 10   | 0%       |

### Gap Inventory

**StR Gaps:** None
**FR Gaps:** None declared; 7 AC gaps exist (FR-011-AC-2–7 integration-only; FR-013-AC-1/2/3 pending stub)
**NFR Gaps:** NFR-002 (tool dependency contract), NFR-003 (API rate/pagination), NFR-004 (cache isolation)
**Constraint Gaps:**

- C-001: External tool availability contract
- C-002: Tap type-collision disambiguation policy
- C-003: Default org resolution chain
- C-004: GitHub API pagination hard limit (100 repos)
- C-005: GitHub API concurrent request volume / rate limit
- C-006: Cache directory scope — registry JSON vs cloned repos
- C-007: Interactive vs automated scaffolding mode
- C-008: Token scope requirements
- C-009: Shallow clone staleness fallback policy
- C-010: Private element repo cloning auth

---

## Analysis of Gaps

### C-001: External Tool Dependency Contract

**The Gap:** `packages/elements` calls `cookiecutter`, `git`, and `gh` via `execa` but no NFR defines required versions, expected PATH availability, or user-facing error messaging when a tool is absent. An `ENOENT` from a missing `cookiecutter` install propagates as a raw error with no remediation guidance.
**Root Cause:** Tools treated as ambient environment assumptions rather than declared dependencies.
**Implied NFR:** All external CLI tools invoked by `ix elements init` SHALL be detected before use; absent tools SHALL produce a message naming the tool and its install URL.
**Skill Improvement:**

- **Technique:** "Tool Dependency Manifest" — any FR that delegates to an external CLI must declare that tool in an NFR: minimum version, detection method (`which`/`--version`), and error message template.
- **Checklist Item:** _Does this command invoke an external CLI tool? If yes, is there an NFR specifying its version contract and the user-facing error when it is absent?_

---

### C-002: Tap Type-Collision Disambiguation Policy

**The Gap:** `resolveElementByType` returns the first match when multiple taps provide the same element type (e.g., both `github.com/agent-ix` and `github.com/my-org` export `fastapi-service`). The first-wins policy is an implicit consequence of tap iteration order — never stated in any FR.
**Root Cause:** The single-tap happy path was designed first; multi-tap disambiguation was never asked.
**Implied FR:** When multiple taps declare the same element type, `ix elements init` SHALL use the element from the highest-priority tap (taps listed first in config take precedence). `ix elements list` SHALL indicate when a type appears in multiple taps.
**Skill Improvement:**

- **Technique:** "Identity Collision Audit" — for any registry or lookup over multiple sources, ask: what happens when two sources claim the same key? Must be an explicit policy (first-wins, last-wins, error, merge).
- **Checklist Item:** _Can two sources in this registry produce the same lookup key? If yes, what is the stated tie-breaking policy?_

---

### C-003: Default Org Resolution Chain

**The Gap:** `scaffold.ts` hardcodes `opts.org ?? "agent-ix"`. The intended source of truth is `~/.ix/config.yaml` (`packages/core`), which is not yet implemented. No FR documents this fallback or the eventual resolution chain.
**Root Cause:** `packages/core` not yet implemented; a stopgap default was embedded without a spec note.
**Implied FR:** The default org for `ix elements init` SHALL be resolved in order: `--org` flag → `~/.ix/config.yaml` `org` field → `"agent-ix"` built-in default. The fallback SHALL be removed once `packages/core` is available.
**Skill Improvement:**

- **Technique:** "Dependency Stub Notation" — when a feature depends on an unimplemented package, the FR must explicitly name the dependency and the interim fallback. Hardcoded values without a spec note are invisible technical debt.
- **Checklist Item:** _Does this default value belong to an unimplemented dependency? If yes, is the resolution chain and interim fallback documented in the FR?_

---

### C-004: GitHub API Pagination Hard Limit

**The Gap:** `searchByTopic` hardcodes `per_page=100`. GitHub returns at most 100 results per page with no indication that results were truncated. An org with >100 `ix-element`-tagged repos silently loses elements.
**Root Cause:** Per-page cap treated as "large enough in practice" rather than a stated architectural limit.
**Implied NFR:** The topic search SHALL paginate through all result pages. If pagination is deferred, the 100-repo cap SHALL be documented as a known limitation in the spec.
**Skill Improvement:**

- **Technique:** "Pagination Completeness Check" — any external API call that returns a paginated collection must declare: is full enumeration required? If bounded, what is the stated cap and is it documented as a limitation?
- **Checklist Item:** _Does this API call return a potentially paginated collection? Is full enumeration required, and is the pagination strategy or cap explicitly stated?_

---

### C-005: Concurrent GitHub API Volume / Rate Limiting

**The Gap:** `fetchElementsForTap` uses `Promise.all` to fire up to 100 concurrent `fetchSpecFrontmatter` calls (one per repo returned by topic search). GitHub's unauthenticated rate limit is 60 requests/minute. An unauthenticated cold-cache load of a 100-repo tap would exceed this immediately. Failures are silently swallowed (`catch { return null }`), causing elements to invisibly disappear from the list.
**Root Cause:** Concurrency was optimised for speed without considering external API rate limits.
**Implied NFR:** Element resolution SHALL NOT exceed GitHub's unauthenticated rate limit (60 req/min). Authenticated requests SHALL be preferred. A sequential or throttled fallback SHALL apply when rate-limit responses (HTTP 429) are received.
**Skill Improvement:**

- **Technique:** "External API Rate Contract" — any code that calls an external API in a loop or via `Promise.all` must have an NFR declaring: max concurrency, rate limit awareness, retry policy, and failure visibility (errors must surface, not be silently dropped).
- **Checklist Item:** _Does this code make multiple calls to a rate-limited external API? Is the concurrency bound and retry policy defined in an NFR?_

---

### C-006: Cache Directory Scope — Registry JSON vs Cloned Repos

**The Gap:** `CACHE_DIR = ~/.cache/ix/elements/` holds both the tap registry JSON files (e.g., `github_com_agent-ix.json`) and the `repos/` subdirectory of cloned cookiecutter templates (written by `scaffold.ts`). `invalidateCache()` with no argument deletes everything in `CACHE_DIR` including all cloned repos. No NFR defines the expected lifecycle separation between registry metadata and template source code.
**Root Cause:** Both concerns were placed in the same directory without thinking through invalidation scope.
**Implied NFR:** Registry metadata (tap JSON files) and cloned element template repos SHALL occupy separate cache directories. Invalidating the registry cache SHALL NOT delete cloned template repos.
**Skill Improvement:**

- **Technique:** "Cache Lifecycle Segmentation" — when multiple types of cached data exist, each type must have its own invalidation trigger, TTL policy, and directory. Mixing them causes unintended cross-invalidation.
- **Checklist Item:** _Does this cache directory contain multiple conceptually distinct data types? If yes, do they have independent invalidation paths?_

---

### C-007: Interactive Scaffolding Mode

**The Gap:** `runCookiecutter` always passes `--no-input`, assuming all template variables are known upfront (`project_name`, `org`). Cookiecutter templates commonly define 10–20 variables (database name, port, feature flags, etc.). Users have no way to provide values for additional variables interactively.
**Root Cause:** "Automation-first" assumption embedded in implementation without an explicit spec decision about interactive vs scripted use cases.
**Implied FR:** `ix elements init` SHALL support an `--interactive` flag (or default to interactive) that omits `--no-input` and allows cookiecutter to prompt for all template variables. `--no-input` mode SHALL be available via a flag for CI/scripted use.
**Skill Improvement:**

- **Technique:** "Human vs Machine Use Case Split" — any scaffolding or generation command must explicitly spec two modes: interactive (human at terminal) and scripted (CI/agent). Defaulting to one without documenting the other is a spec gap.
- **Checklist Item:** _Will this command be used both interactively by humans and non-interactively by agents/CI? If yes, are both modes explicitly specified with their flags?_

---

### C-008: GitHub Token Scope Requirements

**The Gap:** `searchByTopic` calls the GitHub search API, which requires `read:org` scope to include private org repositories in results. `getGhToken()` returns whatever token `gh auth` has stored — which may have been issued without `read:org`. The resulting 401/403 is caught and swallowed, returning an empty list with no explanation.
**Root Cause:** Token scope is an invisible ambient requirement; failures are silently suppressed rather than surfaced.
**Implied NFR:** When GitHub API calls fail with 401/403, the error SHALL be surfaced to the user with guidance on required token scopes. Required scopes SHALL be documented: `read:org` for topic search, `repo` for private repos.
**Skill Improvement:**

- **Technique:** "Auth Scope Declaration" — any external API call that requires specific auth scopes must declare those scopes in an NFR and define the user-facing error when scope is insufficient.
- **Checklist Item:** _Does this API call require specific auth scopes? Are the required scopes documented, and does the code surface a clear error when they are missing rather than silently returning empty results?_

---

### C-009: Shallow Clone Staleness Fallback

**The Gap:** `cloneOrUpdate` does `git pull --ff-only` on a `--depth=1` shallow clone. If the remote's default branch has been rebased or force-pushed since the last clone, this fails. The error propagates raw to the user with no fallback (e.g., re-clone, use stale cache with warning).
**Root Cause:** The update path optimised for the happy case (simple fast-forward) with no spec for the diverged-history case.
**Implied NFR:** If `git pull --ff-only` fails on a shallow template clone, `ix elements init` SHALL re-clone the repo fresh. The stale clone SHALL NOT silently block scaffolding.
**Skill Improvement:**

- **Technique:** "Update Path Failure Analysis" — any cache-update operation must explicitly specify what happens when the update fails: retry, re-fetch-from-scratch, use stale, or abort. The happy path alone is insufficient.
- **Checklist Item:** _What happens when this cached resource cannot be updated? Is the fallback (re-fetch, use stale, abort) explicitly specified?_

---

### C-010: Private Element Repo Cloning Auth

**The Gap:** Element discovery (`fetchSpecFrontmatter`) passes the `gh` auth token to `raw.githubusercontent.com`, so private repos are discoverable. But `cloneOrUpdate` calls `git clone <url>` without explicit credential configuration — relying on the system git credential helper. In environments without a credential helper (Docker, CI), cloning private element repos fails silently.
**Root Cause:** Discovery and cloning have different auth mechanisms; only discovery was considered.
**Implied FR:** `ix elements init` SHALL use authenticated git clone (via HTTPS with token injection or SSH) for private element repos. The auth method SHALL be consistent with the token obtained via `getGhToken()`.
**Skill Improvement:**

- **Technique:** "Auth Mechanism Consistency" — when a feature involves multiple network operations (discovery + download), all operations must use the same auth mechanism. Mixing implicit and explicit auth causes environment-dependent failures.
- **Checklist Item:** _Does this feature perform multiple authenticated network operations? Are all of them using the same credential source, or do some rely on ambient system configuration?_

---

# Implementation Gap Analysis — Cloudflare Tunnel Exposure

**Date:** 2026-05-07
**Scope:** `apps/ix` + `packages/local` FR-038 Cloudflare tunnel exposure
**Retro archive:** Pending

---

## Coverage Summary

| Category                          | Total         | Covered | Gaps | Coverage |
| --------------------------------- | ------------- | ------- | ---- | -------- |
| Stakeholder Requirements (StR)    | 1 (`StR-007`) | 1       | 0    | 100%     |
| Functional Requirements (FR)      | 1 (`FR-038`)  | 1       | 0    | 100%     |
| Non-Functional Requirements (NFR) | 2 implied     | 2       | 0    | 100%     |
| Constraints (C)                   | 6 discovered  | 5       | 1    | 83%      |
| Acceptance Criteria (AC)          | 19            | 19      | 0    | 100%     |

### Gap Inventory

**StR Gaps:** None
**FR Gaps:** None
**NFR Gaps:** None declared; two implicit NFRs were added/covered by tests.
**Constraint Gaps:** C-011 through C-016 below.
**AC Gaps:** None at unit/static level. A live-cluster smoke pass remains useful but is not required to cover a missing AC.

## Analysis of Gaps

### C-011: Helm Upgrade Requires Chart Identity

**The Gap:** `helm upgrade --reuse-values -f <file>` still requires both `RELEASE` and `CHART`. The implementation computed values overlays correctly but omitted the chart ref/version when applying them, so `ix tunnel expose` and `ix tunnel unexpose` would fail at runtime.
**Root Cause:** Tests covered pure overlay merge behavior but not the external command contract.
**Status:** Fixed. `exposeApp`/`unexposeApp` now derive the OCI chart ref from the deployable and pass `--version`; TC-421 covers the Helm argv shape and missing-release error.
**Skill Improvement:**

- **Technique:** "External Command Contract Test" — every code path that shells out must have at least one test asserting required positional arguments, not only flags/options.
- **Checklist Item:** _Does every external CLI invocation include all required positional arguments in the expected order?_

### C-012: String Boolean Coercion Is Not Semantic Boolean Parsing

**The Gap:** `z.coerce.boolean()` maps every non-empty string to `true`, so persisted `autoStart: "false"` enabled tunnel auto-start.
**Root Cause:** The spec said `"true"`/`"false"` but tests only covered `"true"`.
**Status:** Fixed. `StrictBooleanSchema` parses only `"true"` and `"false"` strings as booleans; TC-403b covers the false case.
**Skill Improvement:**

- **Technique:** "Bidirectional Coercion Check" — any config parser that accepts string booleans must test both affirmative and negative literals.
- **Checklist Item:** _If a parser accepts `"true"`, is `"false"` tested and does it really produce `false`?_

### C-013: Background Hooks Must Avoid All Credential Prompts

**The Gap:** FR-038 forbade prompting for the Cloudflare token during cluster auto-start, but the hook could still trigger the GHCR prompt while pulling the cloudflared chart.
**Root Cause:** The no-prompt constraint was scoped to the new credential and missed pre-existing credential dependencies in the same background path.
**Status:** Fixed. Auto-start uses a non-interactive GHCR resolver and skips with a warn-tail Listing when absent; TC-423 covers the no-prompt path.
**Skill Improvement:**

- **Technique:** "Transitive Prompt Audit" — for non-interactive/background commands, trace every helper call for existing prompts, not just newly introduced prompts.
- **Checklist Item:** _Can any dependency below this background path prompt, even for a different credential?_

### C-014: Convenience Flags Need Mode Gating Tests

**The Gap:** `ix up --from-source <svc> --expose` still invoked tunnel exposure even though FR-038 scoped the convenience flag to image mode.
**Root Cause:** The wrapper delegated `fromSource` to `runUp` but the post-success expose hook independently used only `flags.expose`.
**Status:** Fixed. The wrapper gates exposure on `!fromSource`; TC-424 statically guards the condition.
**Skill Improvement:**

- **Technique:** "Post-Delegate Flag Audit" — after a command delegates core behavior, any follow-up side effect must repeat the same mode gates that constrain the delegated path.
- **Checklist Item:** _Does this convenience flag run after a broader command mode switch, and is it disabled in modes where the spec says it is out of scope?_

### C-015: Oclif Command Files Need Build Registration

**The Gap:** New `apps/ix/src/commands/tunnel/*.ts` files were added but not registered as Vite library entries, so they were absent from `dist/commands/tunnel/*` despite being present in source and package topics.
**Root Cause:** Command discovery has two sources of truth: oclif source layout and Vite's explicit entry map.
**Status:** Fixed. Tunnel commands are in `apps/ix/vite.config.ts`; TC-424 checks every command file has a matching build entry.
**Skill Improvement:**

- **Technique:** "Dual Registry Completeness Check" — when a framework discovers files from built output but the build uses explicit entries, every source command must be matched in the build registry.
- **Checklist Item:** _Is this new command registered in every registry required for it to ship, not just in source layout/topic metadata?_

### C-016: Publish-Time Local Dependency Stabilization

**The Gap:** `@agent-ix/ix-ui-cli` is temporarily pinned to `"local"` in publishable packages. This is acceptable during local iteration but must be stabilized before release.
**Root Cause:** Local build-chain workflow intentionally rewrites dependency refs while testing unreleased UI changes.
**Status:** Deferred by operator decision: run `build-chain --stable` after the tunnel changes are built and tested.
**Skill Improvement:**

- **Technique:** "Release Ref Sweep" — before publishing, scan package manifests and lockfile for local/file/workspace refs that are not intended public dependencies.
- **Checklist Item:** _Do publishable package manifests contain temporary `local`, `file:`, or unplanned `workspace:_` refs?\*
