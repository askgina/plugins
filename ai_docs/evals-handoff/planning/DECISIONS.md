# Approved results handoff decisions

Status: accepted by Eric in this conversation, including the final pragmatic guardrail. Recorded on 2026-09-07. This file is the single decision record for the [local delivery map](MAP.md). It records the selected plan; it does not claim implementation or publication has happened.

## Destination and authority

Give Sid a versioned public-results contract, representative fixtures and working exports so he can build the frontend without inventing scoring, evidence or publication rules. Reuse the existing evaluator and app in `askgina/plugins`. Contract and fixtures unblock Sid first; adapters and exporter follow in parallel. Finished delivery still requires the real-data consumer proof below.

Eric explicitly chose this temporary directory instead of GitHub. Keep the map, tickets, evidence and handoff material here. Local implementation and verification are authorized after the documentation step. No GitHub mutations, commits, pushes, PRs, merges, deployments, production permission or credential changes, live MCP calls, paid/live model calls or financial execution are authorized. Requiring genuine results does not authorize generating them through a live evaluation.

## Result meaning and comparison

- First results measure conformance, not answer accuracy, profitability or financial settlement. Preserve existing grading and the complete-single-run-coverage gate. A completed trial with successful tool calls is not proof of a completed trade.
- Existing durable reports remain aggregate-only. Never reconstruct discarded cases, events, state changes or financial receipts. New runs need explicit allowlisted case/attempt summaries with public identities, check verdicts and approved failure categories.
- Identify a pinned system configuration, not just a model display name. Compare only matching declared benchmark conditions. Missing provenance remains visible but unranked. Initial measured comparisons are unranked pilots. Ordinal rankings, a sample-size/uncertainty policy and financial outcome evaluators are outside this handoff.
- Expose passed/failed counts and denominators, unique cases separately from repeated attempts, named conformance dimensions, measured latency percentiles and token usage. Define units and availability. Answer accuracy, USD cost and uncertainty are unavailable without a separate declared method. Missing data is never zero.
- Keep verdict, evidence availability, validity and publication lifecycle separate. Distinguish not evaluated, not applicable, not retained, withheld and aggregate-only evidence. A conformance pass can coexist with unavailable detail; it cannot become a verified financial outcome.
- Cohort coverage requires an explicit authoritative plan and status source. Do not infer missing attempts from absent files or a partial report rejected by the existing sanitizer. Incomplete coverage cannot produce an ordinary headline score or ranking eligibility. Do not build a scheduling service to satisfy this requirement.

## Attempt history and invalidation

Each attempt retains its identity and history. Planned repetitions determine scoring; rerunning until a pass must not erase earlier failures. Preserve the existing grader's failure meanings.

A scoring replacement is allowed only under versioned invalidation rules fixed before the comparison, with an applicable reason, supporting evidence and Eric's recorded approval as the initial benchmark owner. Retain the invalid original and its replacement link. Current `failed` or `blocked` states alone do not establish evaluator infrastructure failure. Without an applicable rule and approval, there is no scoring replacement. Do not add automatic retries or an approval engine.

## Public boundary and delivery

- The framework owns the allowlist and public-data decisions. No raw prompts, tool arguments, tool results, transcripts, wallet/account identifiers, secrets or private hosts enter public exports. Free-form private grading/error text is not automatically an approved failure category. The browser never filters private source data.
- The public contract must be browser-safe. Existing `@askgina/contracts` supports Node/Bun root ESM, not browser, edge or subpath imports. Existing `@askgina/evals` is Bun-only and also unsupported in browsers. Do not import evaluator runtime into the app or implicitly expand either package's runtime/packaging guarantees. Select the concrete DTO/type boundary during implementation within these constraints.
- Deliver reviewed immutable JSON snapshots and an index. Use one explicit, recorded manual approval step. Successful sanitization or CI is not publication approval. No database, live API or always-on service is needed.
- A correction creates a linked revision. The index identifies the current revision and withdrawals; do not silently rewrite published scores. A privacy withdrawal removes sensitive bytes and retains only a safe notice, rather than leaving the content reachable as an old revision.
- Synthetic development fixtures remain persistently labeled and separate from measured publications. Do not promote them through the measured-result path. Sid consumes the public contract and declared derivations; he does not recreate grading, eligibility or disclosure policy.

## Acceptance and excluded work

Sid starts from the agreed contract, field definitions and matching fixtures. Framework delivery finishes when a small browser-safe consumer displays an actual authorized aggregate report export, an actual new-run case breakdown, and missing/withheld/unranked states using public exports without importing Bun evaluator code or implementing scoring rules.

If authorized measured evidence is unavailable, complete all reachable implementation, exercise the real local pipeline using explicitly synthetic inputs, and record exactly which measured evidence remains missing. Neither a synthetic replay nor a good screenshot closes the measured-evidence criterion. No additional live evaluation is implicit.

Frontend redesign, launch pages, editorial, the full proposed catalogue, new financial evaluators and measured ordinal rankings do not block this handoff. Do not adopt the ZIP's proposed financial `PublicRun` unchanged or fill its required fields with invented facts. The original public-site launch backlog is not this delivery map.

## Execution and verification

The local map explicitly includes implementation delivery. Its tickets are implementation work, not unresolved product questions. Main coordinates and integrates. Contract completion releases the aggregate adapter, safe capture and exporter branches; final proof joins them. Keep writing ownership separate and settle shared formats before concurrent edits.

Preserve the repository's Bun 1.4.0, Vite+ 0.3.0, Vitest 4.1.11 and Effect 4.0.0-rc.111 versions. Workers skip builds, tests, formatters and linters during overlapping edits. Main runs local checks after integration, exercises the actual CLI/export path, verifies the browser consumer, and reviews changes against `main`. Record exact commands and outcomes, including what was not run. Do not claim remote CI/CD passed from local checks.

## Sources and observed baseline

- The accepted decisions above come from grilling rounds Q1 through Q14 and Eric's final "yes, pragmatic" confirmation.
- Repository ownership: `AGENTS.md`; normal GitHub tracking conventions: `ai_docs/agents/issue-tracker.md`. Eric's explicit temporary-directory override applies here.
- Runtime constraints: `packages/contracts/README.md:3-14` and `packages/evals/README.md:7-11`.
- Current saved output: `packages/evals/src/report.ts:30-42`; complete-run gate: `packages/evals/src/report.ts:99-106`; conformance completion: `packages/evals/src/grading.ts:186-201`.
- The existing app is `apps/evals`; its `src/data.ts` values are illustrative, not measured results.
- Read-only source inventory by `HandoffDataEvidence` reported no ignored `.plugin-eval-runs` reports in the checkout/common repository/registered sibling and zero Live eval workflow runs on GitHub. No artifacts were fetched and no evaluator was run. Current repository fixtures are synthetic. Genuine aggregate and new-case acceptance evidence therefore remain unavailable at this documentation checkpoint.
