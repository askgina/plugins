# Exec plan — productionise `apps/evals` UI

Amendment to [BRIEF.md](BRIEF.md). The prototype canary shipped and was merged into
the real pages (`99e5dc3`); the app still carries the design-preview skeleton:
illustrative fixtures ranked beside measured rows, fabricated charts, and
prototype-era naming. This plan makes every page structurally real.

**Invariant (unchanged from BRIEF + #102–#104 resolutions):** all metric,
eligibility, coverage, availability and publication semantics stay exactly as
resolved. This plan changes _structure and data sources_, never the semantics.
Nothing presented as measured may be invented; synthetic stays labelled.

## Decisions (settled 2026-09-15)

1. **Audience**: public-readable, evidence-first.
2. **Illustrative data**: dropped entirely. `data.ts`, `task-fixtures.ts` and
   every illustrative code path are deleted, not hidden. Only measured and
   labelled-synthetic rows remain.
3. **Cost**: kept, but derived. A per-model pricing registry holds researched
   metered prices (input/output USD per token, as-of date, source label);
   cost per task is computed from measured token usage where token evidence
   exists, unavailable otherwise. Derived cost is always labelled as derived,
   never presented as a measured field.
4. **"Run an evaluation" button**: kept, repointed. The modal becomes a real
   how-to-run guide for `packages/evals`; all "design preview" framing goes.
5. **`#/models`**: a real index page. Model cards grouped by configuration,
   linking into canonical profiles.
6. **Editorial chrome**: kept for now (heroes, benefits, quotes, task-explorer
   editorial column).
7. **Task explorer**: rebuilt as a case-definition browser plus outcome
   matrix; drilldown only where evidence exists (BRIEF spec 3).
8. **Rank column**: dropped. Sorting stays (headline passes/started is the
   only sort key); no ordinal medals across cohorts that aren't comparable.
9. **Synthetic rows**: removed from every app page. They stay in the
   canonical dataset for Storybook state demos only. Compare still shows real
   blocked states via cross-cohort measured pairs; `labels_only` and
   `incomplete_coverage` demos become Storybook-only.
10. **Derived cost**: computed over whatever population the token statistic
    reports, carrying `sampleCount` + `population` through to the cell,
    labelled "est. cost/task". Unavailable where token evidence is missing.
11. **`#/prototype/*` redirects**: deleted. The canary was never pushed, so
    no external links exist.
12. **Cohort selector default**: "all". Runs render grouped under cohort
    headings with sorting inside each group; selecting a cohort switches to
    the flat sorted table.
13. **Model-profile download**: serves the bundled source artifact bytes via
    a `?url` import, byte-identical to `src/results/`. No in-memory dumps.

## Phase 1 — Shell & routing (`App.tsx`, `components/eval-ui.tsx`)

- [ ] Extract `MethodologyPage` (~170 lines) out of `App.tsx` into
      `pages/methodology.tsx`; `App.tsx` becomes routing only.
- [ ] Replace the `if (route === …)` chain with a route table
      (`{ pattern, render, title }`); keep hash routing, keep `key={route}`
      remounts, keep the `document.title` effect driven by the table.
- [ ] Fix nav "Models" → `#/models/kimi-k3` hardcode: point at the new
      `#/models` index page.
- [ ] Move `PageId`/`ShellPageId` typing out of `data.ts` into the shell module
      (data.ts is slated for deletion).
- [ ] Retire the `eval-demo-label` "Design concept · Illustrative data" header
      chip and the `dataset.disclaimer` footer once illustrative data is gone;
      replace with a real data-origin note.
- [ ] Repoint the "Run an evaluation" modal into a real how-to-run guide for
      `packages/evals`; delete the "design preview" copy.
- [ ] Delete `prototypeRedirect` + `PROTOTYPE_MODEL_IDS` (decision 11).

## Phase 2 — Leaderboard (`pages/leaderboard.tsx` + `.css`)

- [ ] Delete the `IllustrativeRow` path: `models`, `familyMetrics`, `dataset`
      imports, `ScoreBadge` uncertainty rendering, and the rank-medal
      computation (rank is currently derived from illustrative ordering).
- [ ] Delete the rank column entirely (decision 8).
- [ ] Rebuild rows on `canonicalRuns` + selectors: model-first rows, headline
      `passes/started` via `headlineFor`, eligibility reason codes on
      ineligible rows, outside-cohort rows dimmed with reason. Synthetic rows
      are excluded from this page (decision 9).
- [ ] Add the cohort selector; headline metrics and sorts are cohort-scoped.
      Default "all" renders runs grouped by cohort with sorting inside each
      group; a selected cohort switches to the flat sorted table (decision 12).
- [ ] Sorting: single rule — headline sort key, unavailable/absent sorts last
      with explicit reason; delete the kind-based mixed-sort fallback.
- [ ] Columns: drop `Accuracy` (illustrative-only); keep pass rate, p50
      latency (availability-aware via `LatencyValue`), tasks, and a derived
      cost column fed by the pricing registry (decision 3), labelled derived
      and unavailable where token evidence is missing.
- [ ] Charts: quality-vs-latency keeps only availability-aware measured
      points with sample counts; quality-vs-cost returns once derived cost
      exists, plotting only rows with token evidence.
- [ ] Replace the `dataset.label` ("Dataset v0.3") indicator with real
      campaign/cohort descriptors.
- [ ] Hero copy stays per decision 6.

## Phase 3 — Model profile (`pages/model-profile.tsx` + `.css`)

- [ ] Collapse the dual page trees (`MeasuredModelProfile` /
      `IllustrativeModelProfile`) into one canonical profile: model →
      configuration groups by `pinnedSha256` (labels-only separate) → run
      history newest-first with corrections/withdrawals → expandable run
      detail (attempt matrix, per-check outcomes, durations/tokens with
      sample counts, withheld fields, labelled graded-only rate). BRIEF page
      spec 2.
- [ ] Delete fabricated visuals: `buildIllustrativeDistribution` gaussian
      histogram, `±uncertainty` interval bars, illustrative compare modal,
      illustrative download payload.
- [ ] "Download results" serves the bundled source artifact bytes via `?url`
      import, byte-identical to `src/results/` (decision 13). The current
      in-memory JSON dumps go away with the illustrative tree.
- [ ] Fix breadcrumbs hardcoding `#/models/kimi-k3`; bare `#/models` resolves
      per decision 5.
- [ ] `getMeasuredModel`/`measured.ts` lookups replaced by canonical
      `getModel`/run selectors.
- [ ] New `#/models` index page (decision 5): model cards grouped by
      configuration, linking into canonical profiles; bare `#/models` renders
      it, `#/models/:id` renders the profile.

## Phase 4 — Task explorer (`pages/task-explorer.tsx`, `task-fixtures.ts`, `.css`)

- [ ] Delete `task-fixtures.ts` (775 lines of invented kimi/gpt traces,
      rubric, tokens) and the `ComparisonCard`/`TraceBody`/`EvidenceBody`
      fixture rendering.
- [ ] Rebuild on canonical case definitions: family selector incl. Portfolio
      with explicit "no measured evidence" state; versioned case definitions
      (title/objective/expectedBehavior/gradingCriteria; prompt renders
      `Evidence<string>` incl. withheld); model × repetition outcome matrix
      via existing `OutcomeMatrixCell`; per-capability drilldown depth (Sol
      Perps full, Sol Predictions partial, Muse/Claude derived-vs-native
      labelled). BRIEF page spec 3.
- [ ] Fold `MeasuredCasesPanel` + the Spot-only `MeasuredSpotCase`
      (hardcoded reps 1–3) into the canonical matrix — one case table
      implementation, not two.
- [ ] Evidence sidebar/modals rewire to `CanonicalCaseDefinition` fields.
- [ ] Editorial column stays per decision 6.

## Phase 5 — Compare (`canonical/pages/compare.tsx` + `.css`, `canonical/components.tsx`)

- [ ] De-prototype naming: `PrototypeComparePage` → `ComparePage`,
      `eval-proto-*` classes → design-system names, story title
      `Evals/Prototype/Compare` → `Evals/Compare`.
- [ ] Remove `PrototypeBanner`/`PrototypeTag` markers; keep `OriginTag`
      (measured/synthetic) — origin labelling is permanent, prototype
      labelling is not.
- [ ] Route `readCohortScope`/`navigate` through the shared hash helper from
      Phase 1 instead of poking `window.location.hash` directly.
- [ ] Optional: promote `rowStyle`/`chipRow` inline layout styles in
      `canonical/components.tsx` to classes.

## Phase 6 — Handoff & Methodology (`pages/handoff.tsx`, `pages/methodology.tsx`)

- [ ] Handoff is already structurally real (contract parsing, SHA-256
      pairing, revision/withdrawal states) — rename nav label "Public
      results" → "Exports" or "Inspect export" (it is a local-file inspector,
      not a results page); remove the `active === "handoff"` special-casing in
      the shell.
- [ ] Methodology: update "Methodology / Design preview" eyebrow and the
      "synthetic design fixture" panel once illustrative data is deleted;
      keep artifact identities + measured runs panels (already real).

## Phase 7 — Data layer convergence & dead code

- [ ] Delete `data.ts` once leaderboard/model-profile/task-explorer stop
      importing it (models, dataset, familyMetrics, featuredModel,
      FamilyFilter "All tasks").
- [ ] Converge `measured.ts` into `canonical/`: pages consume canonical
      selectors only; `measured.ts` either folds into `canonical.ts` as the
      raw-artifact adapter or shrinks to campaign metadata. One measured
      model, not two.
- [ ] `results/index.ts` stays as the raw artifact import surface.
- [ ] Add the pricing registry (decision 3): per-model metered input/output
      USD prices with as-of date and source label, living in `canonical/` as
      data, not derived inside components. Price source matches how the run
      was actually billed: OpenRouter rates for the Sep 11 controlled
      OpenRouter spot runs, provider list prices for the native Muse/Claude
      runs. Derived cost = measured tokens × registry price over the token
      statistic's own population (decision 10); unavailable where token
      evidence is missing.
- [ ] Sweep `eval-avatar-<id>` per-model classes and other fixture-keyed CSS.

## Phase 8 — Stories, tests, verification

- [ ] Update all story files: new titles, new arg surface (cohort, run ids),
      remove stories pinning illustrative behaviour; `App.stories.tsx`
      imports `MethodologyPage` from its new path.
- [ ] `__tests__/measured.test.ts` pins `measured.ts` shape — rework against
      canonical selectors or delete if coverage moves; `public-results.test.ts`
      unaffected.
- [ ] `bun run evals:typecheck && bun run evals:build && bun run lint &&
bun run fmt:check`; Storybook visual pass incl. 375px mobile on every
      touched page.
