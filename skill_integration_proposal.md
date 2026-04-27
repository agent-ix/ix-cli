# Skill Integration Proposal
## ix-cli / packages/elements — 2026-04-25

Source: `gap_analysis.md` (10 implicit constraints C-001 through C-010)
Target skills: `spec-write-nfr`, `spec-write-fr`, `spec-analysis-integrity`

Six of the ten gaps are systemic patterns — they will recur in any spec that involves external CLI tools, multi-source registries, paginated APIs, or scaffolding commands. The remaining four (C-003, C-006, C-009, C-010) are project-specific or architectural; they belong in a project ADR, not a general skill.

---

## Systemic Gaps Selected for Upstreaming

| Gap | Pattern | Target Skill |
|-----|---------|--------------|
| C-001 | External CLI tool as ambient dependency | `spec-write-nfr` |
| C-002 | Multi-source registry lookup key collision | `spec-write-fr` |
| C-004 | Paginated external API — cap undocumented | `spec-write-nfr` |
| C-005 | Concurrent external API calls — rate limit ignored | `spec-write-nfr` |
| C-007 | Scaffolding command — no human vs CI mode split | `spec-write-fr` |
| C-008 | External API auth scope — silent failure on missing scope | `spec-write-nfr` |

---

## Proposed Patches

### 1. `spec-write-nfr` — Add checklist items

Insert under the existing `## Process` section, after step 3 (Define), as a new sub-section:

```markdown
## Pre-Write Checklist

Before drafting an NFR, verify whether any of these patterns apply to the system context:

| Pattern | Check | NFR Type |
|---------|-------|----------|
| FR delegates to an external CLI (cookiecutter, git, gh, etc.) | Does an NFR declare the tool's minimum version, detection method, and absent-tool error message? | Reliability |
| FR calls an external API that returns paginated results | Does an NFR state whether full enumeration is required? If a cap is acceptable, is it documented as a known limitation? | Reliability |
| FR calls an external API in a loop or via Promise.all / gather | Does an NFR declare max concurrency, rate limit awareness, retry policy, and required failure visibility (errors must surface, not be silently swallowed)? | Reliability / Performance |
| FR calls an external API requiring specific auth scopes | Does an NFR declare the required scopes and mandate a clear user-facing error (not silent empty results) when scope is insufficient? | Security |
```

### 2. `spec-write-fr` — Add checklist items

Insert under the existing `## Process` section, after step 4 (Specify sections), as a new sub-section:

```markdown
## Pre-Write Checklist

Before drafting an FR, verify whether any of these patterns apply:

| Pattern | Check |
|---------|-------|
| FR performs a lookup over multiple sources (registries, plugins, taps) | Is there an explicit policy for when two sources return the same key? (first-wins, last-wins, error, merge). The tie-breaking must be a stated decision, not an implementation artifact. |
| FR involves a scaffolding, generation, or template command | Are both an interactive mode (human at terminal) and a scripted/CI mode explicitly specified, each with their flags? Defaulting to one without documenting the other is a spec gap. |
```

### 3. `spec-analysis-integrity` — Add hidden assumptions check

Insert under step 2 (Consistency & Conflict Analysis), extending the "hidden assumptions" bullet:

```markdown
### Hidden Assumption Patterns (add to Consistency check)

When reviewing FRs for hidden assumptions, explicitly look for:

- **Ambient tool assumptions**: FR delegates to an external CLI but never declares it as a dependency. Probe: "Is this tool assumed to exist on PATH? Is there an NFR?"
- **Single-source design fallacy**: FR reads from a registry or config source without considering multi-source collision. Probe: "Can two sources produce the same key? Is tie-breaking stated?"
- **Automation-only scaffolding**: FR generates or scaffolds files but specifies only one invocation mode. Probe: "Will a human ever run this interactively? Is that mode specified?"
- **Silent auth scope failure**: FR calls an authenticated API but no NFR addresses scope errors. Probe: "What error does the user see if the token lacks required scopes?"
- **Dependency stub masquerading as complete**: FR depends on a package/service that is not yet implemented, and a hardcoded fallback is present with no spec note. Probe: "Is this default value owned by an unimplemented dependency? Is the resolution chain and interim fallback documented?"
```

---

## Not Upstreamed (Project-Specific)

| Gap | Reason |
|-----|--------|
| C-003 (default org resolution chain) | Tied to `packages/core` ADR — document in project spec, not global skill |
| C-006 (cache directory scope) | Cache lifecycle segmentation is good practice but too implementation-specific for a general spec-writing rule |
| C-009 (shallow clone fallback) | Update-path failure analysis is meaningful but specific to git clone + cache interactions |
| C-010 (private repo cloning auth) | Auth mechanism consistency is already implied by C-008 scope; duplicate upstreaming adds noise |
