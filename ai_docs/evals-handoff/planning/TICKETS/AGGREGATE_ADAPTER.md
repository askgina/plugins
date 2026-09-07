# Adapt existing sanitized aggregate reports

[Map](../MAP.md) · [Accepted decisions](../DECISIONS.md)

- Status: implemented and synthetically verified; genuine aggregate acceptance blocked
- Accountable owner: Main
- Implementation assignee: Main; source workers have released their files
- Blocked by: authorized existing measured aggregate evidence only
- After contract: parallel with [attempt capture](ATTEMPT_CAPTURE.md) and [exporter](PUBLICATION_EXPORT.md); feeds [consumer proof](CONSUMER_HANDOFF.md).

## Target

Map actual durable sanitized reports into validated public aggregate DTOs, without reconstructing discarded case details. Ground the adapter in `packages/evals/src/report.ts`, including `SanitizedEvalRunReportSchema`, `sanitizeEvalReplay` and `makeSanitizedEvalRunReport`.

## Work

- Map retained run metadata and aggregate suite/version/fixture/catalog provenance, overall counts, routing/arguments/safety/completion dimensions, skill activation, latency, result bytes and token usage. Document each mapping and denominator. Preserve measured units and token-observation coverage; do not turn unavailable metrics into zero or infer new percentiles from aggregate values.
- Decode the source and validate the public output. Preserve existing sanitization/provenance checks and the complete-single-run gate: observed count equals expected observations and coverage equals one. Do not combine partial runs to bypass that gate.
- Mark historical evidence aggregate-only. Never fabricate cases, attempts, events, state changes or financial receipts. Derive unique-case counts only when authoritative metadata establishes how observations relate to cases and repetitions; otherwise expose the count as unavailable. Missing pinned configuration or provenance remains explicit and unranked; a model label alone is insufficient. Matching declared benchmark conditions constrain comparison; initial measured results remain unranked pilots.
- Coverage displays require an explicit authoritative plan/status source. Absent files or rejected partial reports cannot establish missing attempts. Incomplete coverage cannot yield an ordinary headline score. Keep acquisition of authorized inputs separate from adaptation; add no live evaluation or scheduling service.

## Acceptance

The real local adapter/export path preserves source-supported counts and provenance, emits valid aggregate-only output and exposes unsupported fields as unavailable. Synthetic malformed, incomplete and provenance-mismatch inputs demonstrate rejection without weakening existing checks. No discarded details appear in output.

## Evidence

The zero-observation/nonzero-total guard and typed-digest privacy checks are repaired. Focused regressions and compiled aggregate/detail/withheld/incomplete exports passed; the actual consumer displayed their declared states. Commands and receipts are in [HANDOFF.md](../../HANDOFF.md). Genuine closure still requires an authorized durable aggregate report and its export in the consumer. Sanitization is not publication approval.
