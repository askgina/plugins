# Bounded prediction-search grading revision — 21 September 2026

The published discovery rubric required exactly one search, contradicting the
pinned skill's allowance of up to three distinct searches when results miss the
request. `bounded-prediction-search-v1` changes this deterministic routing check
for the eight discovery cases. One to three nonempty, distinct queries are
allowed; only the required search tool is allowed, and the first query must
remain the original request. Existing argument, safety, completion and optional
skill checks retain their recorded outcomes.

This is tool-use conformance, not final-answer quality. This routing check does
not determine search relevance, whether a follow-up was necessary, or whether
the final answer is grounded. The mark-price fixture mismatch, HIP-3 argument
targeting, server/tool errors and native error-mirroring issues remain outside
this revision. No model-specific score target is used.

## Evidence and results

`bun tools/regrade-eval-search.ts --check` reproduces the checked-in receipt from
the immutable public results and digest-bound visible tool-call captures. It
checks all 841 completed discovery attempts in the 16 and 21 September campaign
rows, including incomplete configurations. Baselines repeated across campaigns
are not independent executions.

- 543 routing checks change across 39 family runs.
- 426 row-level verdicts change from fail to pass (376 distinct underlying trials).
- 117 routing corrections still fail another retained check.
- One provider-error record becomes ungraded.
- There are no changes to original result JSON, transcript bytes, model output,
  cost records, safety outcomes, or non-discovery grades.

The public receipt contains only identifiers, checks, hashes, input paths, counts
and a reviewed numeric cost exclusion. Its exact bytes are approved by the public
artifact guard. Each correction binds the original source summary and transcript
SHA-256 plus case/repetition; mismatches fail closed. The original canonical runs
remain separately accessible to verification. Tasks → Checks shows the former
verdict and routing outcome; Methodology links the machine-readable revision.

The future grader uses the same bounded-search function as retrospective replay.
The changed fixture/grader hashes and policy version are recorded in the receipt;
the original campaign suite and grader hashes remain original provenance. Tests
cover empty/excess/duplicate searches, wrong tools, first-query mismatch, tool
errors and forbidden tools, plus all changed attempts and leaderboard aggregates.

## Provider-error classification

The selected Astra xhigh `predictions-multi-series-no-render`, repetition 2,
terminal has SHA-256
`06f55ad41d38b8212f3d53ff2e385d06cc6cf3f7476f93e57e29224a77c7628f`.
Its retained final answer is a provider rejection of the unsupported
`access_programs` parameter, not a model answer. There are no financial-tool
calls. The native evidence was audited outside the public repository; the public
projection omitted this error text. The receipt records the reviewed terminal
identity, not private message contents.

The original duration was 17,139 ms, with 435 input, 24 output and 14,336 cache-read
tokens. Native cost was $0.019886. The revised selected-graded metrics exclude
that execution while retaining its chat, wall time, usage and original record.
Predictions has 38/39 valid grades and the setting has 104/105. xhigh is therefore
unranked until a valid execution fills that slot. No new inference was performed
for this grading revision. The VM's older “210 graded” status is not proof of 210
valid model responses.

## Rollback and remaining work

The source snapshots remain untouched. Revert the revision receipt/application
and future rubric changes to reproduce the old deterministic results. Retain the
provider-error diagnosis even if reverting the search policy; it is independently
invalid. Further rubric changes must be versioned and applied to all models with
adequate evidence. Never turn service failures into quality passes or retry valid
failed answers until they pass.
