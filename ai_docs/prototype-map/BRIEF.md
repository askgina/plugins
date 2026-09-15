# Prototype map brief — canonical eval browsing (`#/prototype/*`)

Continuation of the Wayfinder map (issue #100) prototype ticket (#101), built in the
design system currently on `main`. A first canary was deployed for owner review but
never pushed; this branch re-implements and completes the full prototype scope.
Prototype = throwaway, clearly labelled, and confined to `apps/evals/src/prototype/`.

## Hard rules

- Do not modify existing pages or components. Only `App.tsx` (routes) and the nav
  entry in `components/eval-ui.tsx` may reference prototype code — both already wired.
- Reuse the design system: `PageShell`, `Panel`, `ModelAvatar`, `ScoreBadge`,
  `FamilyTabs`, `Modal`, `components/ui/*`, `eval-*` classes and tokens from
  `styles/design-system.css` + `styles/evals.css`. New page CSS may define
  `eval-proto-*` hooks like existing `pages/leaderboard.css`.
- Lint is enforced (`bun run lint`): `shadcn/no-raw-colors`,
  `shadcn/no-arbitrary-values` (allow: layout), `shadcn/no-restyle` (allow: layout +
  named evals hooks), `shadcn/require-static-classes`.
- Every prototype page shows a "Prototype" marker (banner/chip) so it cannot be
  mistaken for the current pages.
- Measured numbers must match the bundled artifacts under `apps/evals/src/results/`
  and `apps/evals/src/measured.ts`. Nothing presented as measured may be invented.
- Synthetic rows exist only to demonstrate states no retained campaign exhibits
  (unstarted, unknown coverage, labels-only, withdrawal). Mark each "synthetic".

## Resolved semantics (from #102/#103/#104 — implement, do not re-litigate)

- Execution status: `completed`, `timed_out`, `runtime_failure`, `pending`,
  `unstarted`, `unknown`. Started = completed + timed_out + runtime_failure + pending.
  `unstarted` requires an authoritative plan/status source, else `unknown`.
- Grading verdict: `pass`, `fail`, `not_graded`. Only `completed` carries pass/fail;
  timeouts and runtime failures are `not_graded` (never manufactured fails).
  Runtime failure attribution: `infrastructure` | `agent` | `unattributed` (default).
- Checks: `pass` | `fail` | `not_applicable` | `not_evaluated` per check.
  `checkSource`: `native` | `derived_from_scores` (one checks object).
- Dispatch coverage: `complete` | `incomplete` | `unknown`. Grading coverage:
  `complete` | `partial`.
- Headline = passes / started — the ONLY sort key; available only when dispatch
  coverage is `complete` (`incomplete` → `incomplete_coverage`,
  `unknown` → `coverage_unknown`, both show counts, no rate).
- Graded-only rate (passes/graded) appears ONLY in run detail, always labelled
  "graded-only rate (excludes N timed out, M runtime failures)".
- Every latency/token statistic carries `sampleCount` + `population`
  (`started`|`completed`|`graded`); missing measurements are absent, never zero.
  `aggregate_only` = statistic retained, sample count not — disclosed.
- Availability vocabulary: `not_retained` (never captured/not in bundle),
  `not_recorded` (expected but missing in source), `withheld` (exists, excluded by
  review policy — e.g. `privacy_review`), `aggregate_only`, `no_declared_method`.
- Eligibility reasons are additive codes on every row/page: `pilot`, `synthetic`,
  `incomplete_coverage`, `coverage_unknown`, `missing_pinned_configuration`,
  `labels_only_configuration`, `different_evidence_category`,
  `outside_selected_cohort`. Explanation text derives from codes; components never
  write their own policy text.
- Configuration grouping by exact `pinnedSha256`; `labels_only` runs stand alone.
  Cohort = machine-readable comparison key (suiteId+suiteVersion+fixtureVersion+
  catalogSha+target+accountClass+repetitions+evidence category).
- Comparison eligible: equal cohorts, both pinned, no blocking reason. Differing
  `checkSource` is a visible condition difference, not a block.
- Representative run: per model×family×config group, newest `startedAt` among
  non-withdrawn publications with dispatch coverage `complete`; else newest run with
  no headline + coverage reason. Corrections don't move the pick.
- Dedup: the Muse report embeds Sol baseline numbers — Sol runs import once from
  September 11 sources; Muse `sol` blocks are `baselineRunId` references.
- Family is explicit, never inferred from case-name prefixes.
- Corrections/withdrawals keep the v1 lifecycle: contiguous revisions, corrected
  bytes reachable, withdrawals remove bytes but stay visible in history.

## Canonical dataset (13 retained family runs + required synthetic rows)

| Run                                       | Source                                                           | Coverage | Headline  | Detail capability                                                                                                                                                                | Notes                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------- | -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `gpt-5.5` Spot (2026-09-11)               | spot-comparison report                                           | complete | passes/12 | detailed attempts, native checks, bound_by_suite                                                                                                                                 | controlled OpenRouter                                                                                 |
| `gpt-5.6-sol` Spot (2026-09-11)           | spot-comparison report                                           | complete | passes/12 | detailed attempts, native checks, bound_by_suite                                                                                                                                 | controlled OpenRouter                                                                                 |
| Sol Perps (2026-09-11)                    | `perps-openai-oauth-sol-20260911T152450Z` + 54-attempt companion | complete | passes/54 | detailed, checks+durations+tokens 54/54, bound_by_suite                                                                                                                          | native agent                                                                                          |
| Sol Predictions (2026-09-11)              | `predictions-openai-oauth-sol-durable-20260911T161134Z`          | complete | 12/39     | partial: per-case repetition outcomes + category notes; per-attempt checks/durations `not_retained`; latency aggregate_only p50 33,782 / p95 62,651 / max 113,558; tokens 38 obs | started 39, completed 38 (12 pass, 26 fail), timed_out 1                                              |
| Muse Spark 1.3 Spot (2026-09-14)          | `campaign-result.json` (sourceKind: campaign_result)             | complete | 9/12      | detailed trials, native checks                                                                                                                                                   | 9 pass, 3 timed_out — NOT unstarted; durations+tokens 9 of 12 (`not_recorded`)                        |
| Muse Spark 1.3 Perps (2026-09-14)         | sanitized report                                                 | complete | /54       | detailed trials                                                                                                                                                                  | durations/tokens 54/54                                                                                |
| Muse Spark 1.3 Predictions (2026-09-14)   | `campaign-result.json`                                           | complete | /39       | detailed trials                                                                                                                                                                  | durations 38/39                                                                                       |
| Claude Fable 5.1 Spot (2026-09-14)        | comparison artifact                                              | complete | 11/12     | detailed, checks `derived_from_scores`; answers+tool args `withheld: privacy_review`                                                                                             | 11 pass, 1 runtime_failure unattributed (spot-fetch-swap-history rep 3, wall 27,315ms); tokens 11/12  |
| Claude Fable 5.1 Perps (2026-09-14)       | comparison artifact                                              | complete | /54       | same as above                                                                                                                                                                    | —                                                                                                     |
| Claude Fable 5.1 Predictions (2026-09-14) | comparison artifact                                              | complete | /39       | same as above                                                                                                                                                                    | —                                                                                                     |
| Claude Opus 5 Spot (2026-09-14)           | comparison artifact                                              | complete | /12       | same derived checks                                                                                                                                                              | —                                                                                                     |
| Claude Opus 5 Perps (2026-09-14)          | comparison artifact                                              | complete | 41/54     | same derived checks                                                                                                                                                              | 53 completed (41 pass, 12 fail), 1 runtime_failure unattributed (perps-markets rep 1, wall 120,702ms) |
| Claude Opus 5 Predictions (2026-09-14)    | comparison artifact                                              | complete | /39       | same derived checks                                                                                                                                                              | —                                                                                                     |

Fill exact counts from `apps/evals/src/results/**` + `measured.ts`; the table gives
anchors, not authority. September 14 runs have no frozen suite YAML → case binding is
`bound_by_catalog_sha` (label "definition matched by catalog hash").

### Synthetic rows (labelled synthetic; states retained data lacks)

- `sol-spot-incomplete`: planned 12, started 11, one proven `unstarted` →
  `incomplete_coverage`, counts shown, no rate.
- `sol-spot-unknown`: same shape without authoritative status → 1 `unknown`,
  `coverage_unknown`.
- `sol-spot-labels-only`: configuration `labels_only` → `labels_only_configuration`,
  excluded from pinned comparison.
- `sol-spot-1` corrected by `sol-spot-1` revision 2 (correction lifecycle example)
  and one withdrawn publication (shown in history, excluded from representative pick).
- A model with no runs in the selected cohort (outside-cohort display).
- Multiple configurations/runs per model (e.g. `sol-spot-1`, `sol-spot-2`).

## Page specs (all under `#/prototype/*`, PageShell active="canary")

1. `#/prototype/leaderboard` — model-first rows; family tabs Spot/Perps/Predictions
   (Spot default/reset — preserve the PR #98 decision; NO "All tasks"); cohort
   selector; headline passes/started; representative run identified+linked;
   sample/denominator disclosure; outside-cohort rows dimmed with reason;
   ineligible rows show reason codes; synthetic rows labelled.
2. `#/prototype/models/:modelId` (optional `?run=<runId>`) — configuration groups by
   pinnedSha256; labels-only runs separate; run history (newest first; corrections
   show revisions, withdrawals shown); family results; case consistency; expandable
   run detail: attempt matrix, per-check outcomes, failure categories, task+wall
   durations and tokens with sample counts, withheld fields rendered as withheld,
   graded-only rate labelled, runtime failures + attribution, incomplete/unknown
   runs show counts with no rate.
3. `#/prototype/tasks` (`?family=`) — family selector including Portfolio
   (definitions only — no measured Portfolio evidence; the tab stays but shows an
   explicit "no measured evidence" state); versioned case definitions
   (title/objective/expectedBehavior/gradingCriteria/prompt or `withheld: not_bound`);
   model-by-repetition outcome matrix; detail depth per capability (Sol Perps full
   drilldown, Sol Predictions partial, Muse/Claude derived-vs-native labelled).
4. `#/prototype/compare` (`?left=&right=`) — run pickers scoped to selected
   cohort + evidence category; eligible → side-by-side metrics/attempts with
   visible condition differences (e.g. `checkSource` differs); blocked →
   specific reason, no delta. Do not require identical pins across models.
5. `#/prototype/methodology` — benchmark/grader versions, coverage + limitations
   per campaign, provenance (runId + source artifact sha), publication lifecycle
   (revisions/withdrawals), canonical export links (describe/link
   `eval-result.v1`/`eval-result.v2` shapes — do NOT invent an unversioned format),
   downloads section.

## Verification (must pass before push)

```sh
bun install --frozen-lockfile
bun run evals:typecheck
bun run evals:build
bun run lint
bun run fmt:check   # run `bunx vp fmt -w` on touched files if it complains
```

## Deliverable

Each page agent edits ONLY its assigned file(s) under `apps/evals/src/prototype/`
and pushes its own branch `devin/evals-prototype-map--<page>`. The merge agent
combines them into `devin/evals-prototype-map`. No PR is opened.
