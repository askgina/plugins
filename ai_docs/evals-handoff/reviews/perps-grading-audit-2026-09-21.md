# Why the current ranking is not a model-quality ranking

**Update:** The mark-price and HIP-3 defects described below are now corrected by
[perps-price-evidence-v1](./perps-price-regrade-2026-09-21.md). This document records
the pre-correction audit. Its examples of passes/failures refer to the preserved
original grades. General answer-quality and service-failure issues remain open.

This is a retained-evidence audit, not another score revision or a claim that a
particular model must win. Search routing has been revised separately. The Perps
and answer-quality issues below still need an explicit, model-independent rubric.

## Incorrect price semantics receive passes

The single-price prompt asks for the BTC **mark**; the multiple-price prompt asks
for BTC/ETH/SOL **marks**. Their fixtures instead require exactly one call to
`getHyperliquidPrice` / `getHyperliquidPrices`. The skill describes those tools as
midpoint reads. The observed single-price payload contains `price` and `mid`;
the markets payload contains the separate `markPrice` field.

In Grok low, single-price repetitions 2–3 and all three multiple-price attempts
receive passes despite explicitly answering with midpoints. Single-price
repetition 1 calls the price tool, then the markets tool, and quotes the retained
`markPrice` correctly; that attempt fails exact-one-call routing. Evidence is in
`apps/evals/public/transcripts/grok-low/perps/{repetition}-{caseId}.json`, bound to
source summary `2ade7d479d64513a5f0b255b84c19f82925ab75fd3e18f7cc1586673238b7a6c`.

The audited Astra xhigh/max mark-price answers use markets data and match the
retained marks, but all twelve fail the expected midpoint-tool routing. This is
a contradiction between the task and fixture, not evidence of worse answers.
Fable also frequently returns midpoints on these tasks; fixing this correctly
can lower some existing passes as well as restore incorrectly failed answers.

## Required HIP-3 confirmation is penalized

The skill requires a venue-scoped markets read to confirm a HIP-3 ticker before
quoting it. Astra xhigh/max perform that read before the CL price call. The
fixture requires exactly one call and leaves its argument constraint unbound,
so the grader checks `coin: CL` on the preliminary markets lookup instead of
the correctly parameterized price call. Grok low skips the preliminary lookup
and passes. The accepted sequence and argument target must be fixed together.

## Fable's useful answers are not the scored quantity

Fable medium `predictions-series-market`, repetition 1, finds the BTC 15-minute
series after a cricket misclassification, but its first query omits part of the
original wording. That violates the pinned unchanged-query policy even though
its retained answer supplies the requested series. Fable medium
`predictions-multi-series-no-render`, repetition 1, uses the series-specific tool
to report several timeframes after discovery misses intent; it fails a
search-only tool contract. Those are tool-policy failures, not independent
answer-correctness judgments. Other Fable failures include service errors and
unresolved task outcomes; they must not all be promoted to passes.

## Consequences for interpretation

After the bounded-search correction, Astra high leads Grok low in Predictions
(32/39 versus 30/39); both pass Spot (12/12). Grok's aggregate lead comes from
Perps (40/54 versus 33/54), where the above contradictions are material.

A sound next revision must distinguish task correctness and grounding, policy
compliance, execution/service availability, and efficiency. Preserve their
separate evidence and denominators. Apply price semantics and HIP-3 changes to
all models, review both current passes and failures, and retain original grades.
Do not rename conformance as answer quality or select a rubric to force an
expected model order.

## Duplicate campaign copies

Grok low in the later campaign is the same 105 original attempts, not a new run.
The leaderboard now deduplicates fully graded rows only when every selected
attempt's source identity matches, preferring the original campaign. Campaign
filters still expose their original records, and independent executions with
equal scores remain separate. This changes presentation and displayed totals,
not evidence or model scores.
