# Ink rewrite — handoff for next session

## tl;dr

Phases 0–4 done. Tree is clean: build green, lint clean, 348/348 tests
passing across the workspace. Only Phase 5 (live-cluster verification of
the resize bug fix) remains.

## Where to pick up

```bash
cd /home/peter/dev/ix-cli
git checkout ink-rewrite
git log --oneline -15

cd /home/peter/dev/ix-ui
git checkout ink-rewrite      # parallel branch; ix-cli consumes via link:
```

Both repos are on the `ink-rewrite` branch. ix-cli's `@agent-ix/ix-ui-cli`
dep points at `link:../../../ix-ui/packages/cli` (set in 4 consumer
package.jsons).

`ix` on PATH is symlinked to `/home/peter/dev/ix-cli/apps/ix`, so
`ix local …` invocations hit whatever was last `make build`'d.

## Phases status

| Phase | What | Done | Where |
|---|---|---|---|
| 0 | branches, dep swap, link consumer to local ix-ui-cli | ✅ | ix-ui `c02750f`, ix-cli `link:` refs |
| 1 | spec rewrite + 4 gates (review, integrity, failure-domain, matrix) | ✅ | ix-ui `0117da9` `0e17b27` `974ca67` |
| 2 | Ink components + hooks | ✅ | ix-ui `5d9eb76` |
| 3 | test suite on ink-testing-library — 74 tests green, lint clean | ✅ | ix-ui `06a3dc6` |
| 4 | migrate ix-cli consumers to JSX | ✅ | ix-cli `74a900e` `de3ecd2` `1f384e7` `5e6b36d` + Phase 4 finish (this session) |
| 5 | end-to-end verification (incl. resize-bug repro) | 🔘 | needs live kind cluster |

## Phase 4 finish (this session)

Migrated the last 4 source files plus surrounding test cleanup:

- **`packages/local/src/app-row-state.ts`** — reshaped `AppInstallRows`
  from a `display.transition()` driver into a snapshot emitter.
  Constructor signature is now `(services, onChange)`; the class emits
  `ServiceRow<Phase>[]` snapshots on every state change. Internal
  aggregate logic (hook-vs-k8s arbitration, terminal-failure freeze) is
  unchanged.
- **`packages/local/src/commands/up-image.tsx`** — single-service path is
  sequential awaits + final `<Listing>`. Multi-service app path mounts
  `<AppPhaseTable>` which runs the imperative pipeline (helm pull →
  secrets → umbrella install → per-subchart rollout watchers) in a
  `useEffect`, pipes the `appRows` snapshot into a declarative
  `<PhaseTable services={state}>`, and exits via `setTimeout(exit, 0)`
  after the final state paint.
- **`packages/local/src/commands/init-cluster.tsx`** — `<InitClusterUI>`
  React component drives a `<PhaseTable phases={["run"]}>`. Each
  bootstrap step (kind / cert-manager / ca-issuer / ingress-nginx /
  wildcard cert / ingress-tls / wait-cert / namespaces+rbac / dns)
  transitions running → done/failed via `setRow`. Final tail is the
  dnsmasq instructions on success or the error message on failure.
- **`packages/local/src/commands/auth-config.tsx`** — every sub-command
  (email enable/disable/show/test, password-reset set/show, social
  add/remove/list/show, registration set/show) is now sequential awaits
  + final-state `<Listing>`. No more `makeListr` / `startListing`.

Also: `cluster-status.tsx` and `list.tsx` had stray `from "ink"` imports
left over from group 3 — switched to the `Box`/`Text` re-exports on
`@agent-ix/ix-ui-cli`.

### Test cleanup

The static-check tests still searched `*.ts` only; updated `walkTs` /
`grepSrc` / `readSrc` helpers in `tests/static-checks.test.ts` and
`tests/auth-static-checks.test.ts` to recognize `.tsx` too, with a
fallback that swaps `.ts` → `.tsx` for legacy paths in the
namespace-allowlist.

Several tests assumed the old API (`startListing`, `list.success`,
`list.note`, `list.item`, `display.transition` on a stateful PhaseTable
class). New shared helper at
`packages/local/tests/listing-helpers.ts` (also copied into
`packages/elements/tests/`) installs a `vi.mock` for
`@agent-ix/ix-ui-cli` that replaces components with string-typed stubs
and records every `renderStatic(<Listing …>)` call as a `ListingCall`
with `header / status / tail / tailVariant / notes / items / groups /
texts`. Tests now assert against that record instead of the old
imperative call sequences.

Migrated tests:
`tests/app-row-state.test.ts` (snapshot-based assertions),
`tests/cluster-down.test.ts` (with new `confirm` test seam injected
into `runClusterDown`),
`tests/cluster-status.test.ts`,
`tests/auth-init.test.ts`,
`tests/auth-reset-admin.test.ts`,
`packages/elements/tests/tap-list.test.ts`.

Static-check regex updates for the new declarative implementation:
TC-103 (`<PhaseTable<Phase>` / `phases={PHASES}` / `phaseLabels={…}`),
TC-280a (format-tolerant `findInstallForHookJob` regex),
TC-280c (`finalDisplayError ?? err.message` instead of the old
`display.finish({failed:true,error:…})`),
TC-301 (`<Item …formatRefreshChange…>` instead of `list.item(…)`).

### Source seam introduced

- `runClusterDown(config, opts, deps?)` — new third arg
  `ClusterDownDeps` with `{ confirm?: (clusterName) => Promise<boolean> }`.
  Default uses Ink `<ConfirmPrompt>`; tests inject a stub. Same shape as
  the existing `IdentityDeps` seam in `runAuthInit` /
  `runAuthResetAdmin`.

## Status of artifacts

```bash
# in ix-ui
cd /home/peter/dev/ix-ui && make build && make test && make lint
# 74 tests green, build + lint clean

# in ix-cli
cd /home/peter/dev/ix-cli && make build && make test && make lint
# core 128/129 (1 skipped), elements 50/50, local 170/170 — all green
# build + lint clean
```

## Phase 5 — what's actually left

None of this is blocking the migration; it's runtime verification of
the new code on a live cluster.

### 1. Resize-bug repro (the original motivation)

```bash
ix local up auth                     # multi-service phase table runs
# … resize the terminal narrower mid-run.
# Pre-fix: spinner emits newlines instead of in-place updates.
# Post-fix: PhaseTable rows truncate and re-flow cleanly.
```

If this works, the migration delivered what it was supposed to.

### 2. Smoke the new code paths

Each of these exercises a different new file. Worth a quick sanity run
since they couldn't be tested without a cluster:

- `ix local init` — init-cluster.tsx, single-column PhaseTable
- `ix local up <app>` — up-image.tsx multi-service path (the bug-trigger)
- `ix local up <service>` — up-image.tsx single-service path
- `ix local auth init` — final-state Listing with credential notes
- `ix local auth reset-admin` — same
- `ix local auth invite <email>` — same
- `ix local auth config email enable …` — auth-config.tsx mutation +
  rollout
- `ix local cluster status` / `cluster down` / `local list` — already
  smoked, sanity only

### 3. Optional polish (if anyone wants to go further)

- **TC-100..TC-333 plan** in `/home/peter/dev/ix-ui/spec/tests.md` —
  TC-100..210 + TC-300..313 + TC-320..333 + a few TC-OP / TC-EC are
  implemented. The remaining "🔘 Planned" cases would round out the
  matrix; not blocking.
- **`cluster-up.ts` `process.stdout.write("\n")` separators** between
  per-service blank lines — could be folded into a stacked `<Listing>`
  layout. Tracked in handoff gotcha #6 from the prior session.

## Migration patterns (still current)

### Pattern 1 — final-state listing (most common)
```tsx
import { Listing, Item, Note, renderStatic } from "@agent-ix/ix-ui-cli";

await renderStatic(
  <Listing header="…" status="passed" tail="done">
    <Note>{`Username: ${name}`}</Note>
    <Item name="foo" description="bar" />
  </Listing>
);
```

### Pattern 2 — failure path
```tsx
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  await renderStatic(
    <Listing header="…" status="failed" tail={`Failed: ${msg}`} tailVariant="error" />
  );
  throw err;
}
```

### Pattern 3 — interactive prompt
See `packages/core/src/commands/secrets.tsx` (`promptForPassword`),
`packages/local/src/credentials.tsx` (`promptForToken`),
`packages/local/src/local-secrets.tsx` (`promptForSecret`),
`packages/local/src/commands/cluster-down.tsx` (`defaultConfirm`).

### Pattern 4 — subprocess with inherited stdio
For commands that spawn an external tool which prints its own output
(npm install, helm, kubectl apply, kind delete, $EDITOR, cookiecutter,
gh repo create, make), do **not** wrap the subprocess in Ink. Run it
normally, let stdio inherit. Render a final-state `<Listing>` after.

### Pattern 5 — PhaseTable (live multi-service progress)
The component is declarative — props are the state, not a stateful
class. Examples in production:

- `packages/local/src/commands/init-cluster.tsx` — simple single-column
  state machine with explicit `setRow` updates per step.
- `packages/local/src/commands/up-image.tsx` `AppPhaseTable` — the full
  reactive pattern: `AppInstallRows` snapshot listener feeds `setState`,
  React mounts `<PhaseTable services={state}>`, the imperative pipeline
  runs in `useEffect` and dispatches transitions via the listener. Plus
  a `setFinalState` for the post-run frame state/tail/tailVariant.

The hooks `useExecaPhase`, `useKubectlRollout`, `useHelmHookWatcher` in
`/home/peter/dev/ix-ui/packages/cli/src/hooks/` are available for
simpler cases that don't need the imperative orchestration up-image
needs (terminal failure detection, hook-vs-k8s arbitration, settling
markers).

## Gotchas / lessons (still relevant)

1. **`@agent-ix/ix-ui-cli` only.** Never import directly from `ink` in
   consumer code. Use `useRenderResult` from `@agent-ix/ix-ui-cli`
   instead of ink's `useApp`. ix-ui-cli re-exports `Box` and `Text`
   from ink.

2. **`renderStatic` for one-shot final-state UIs.** Adds an
   `ExitAfterPaint` wrapper that auto-unmounts after the first paint.
   For interactive flows or live PhaseTables, use `render()` directly
   with components that call `useRenderResult().exit()` (typically
   wrapped in `setTimeout(exit, 0)` after `setFinalState`) when done.

3. **`@types/node` resolution.** Root `tsconfig.json` needs
   `"types": ["node"]` under compilerOptions, otherwise
   vite-plugin-dts fails with "Cannot find name 'node:crypto'"
   cascading errors. Already set; just don't accidentally remove it.

4. **JSX whitespace + prettier.** Prettier collapses adjacent spaces
   in `<Text> foo </Text>`. For deliberate whitespace use template
   strings: `<Text>{` ${x}  `}</Text>`. Frame.tsx Tail uses this
   pattern.

5. **Static-check regexes are format-sensitive.** Prettier may split a
   call like `findInstallForHookJob(installs, hookFailure.jobName)`
   over multiple lines. Make new static-check regexes
   whitespace-tolerant (`\s*`) when asserting on call sites.

6. **NFR-002 / NFR-003 static greps in `nfr.test.ts`** scan source for
   `process.stdout.write`, ANSI literals, raw `└──` / `⊙` / `⊗` / `⊕`
   / `●` / `○`. These run as part of `pnpm --filter @agent-ix/ix-ui-cli
   test`. **Don't add these to consumer code either.**
   `cluster-up.ts` still has `process.stdout.write("\n")` separators —
   see Phase 5 polish item.

7. **vite v8 default is browser.** `ssr: true` is set in
   `ix-ui/packages/cli/vite.config.ts` to externalize node built-ins.

## Spec status

`/home/peter/dev/ix-ui/spec/` is fully refreshed. FRs FR-001..FR-008 +
FR-009/10/16, NFRs NFR-001..NFR-003, traceability matrix in tests.md
(StR/US/FR/NFR → AC → TC) including Option Permutation Matrix,
Constraint Boundary Tests, and Edge Cases sections per the
spec-matrix template. No old-impl references remain.
