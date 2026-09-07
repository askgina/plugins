# Implementation coordination contract

This note fixes interfaces for the first concurrent code workers under the accepted [map](MAP.md). It does not alter the product decisions in [DECISIONS.md](DECISIONS.md). The workflow tool failed with disk I/O before returning an implementation run ID. Main is coordinating direct local tasks; do not retry or create another autoimplement run.

## Ownership

- Contract worker owns `packages/contracts/src/eval-results.ts`, its exports from `packages/contracts/src/index.ts`, synthetic public JSON examples under this temporary directory, and a concise public field reference here. Do not add package exports/subpaths or browser runtime support.
- Capture worker owns `packages/evals/src/public-attempts.ts` and the existing replay/runner/live/bin callsites required to capture and optionally write safe summaries. Main owns changes to `packages/evals/src/index.ts`, root build configuration/scripts and packaging guards. Ask Main before touching those shared files.
- Both workers skip builds, tests, formatters and linters until integration. They may add narrowly justified behavioral regressions, but do not run them concurrently.
- Adapter/exporter/browser-consumer workers start after the result/publication schemas are concrete. They must consume those schemas rather than invent another convention.

## Shared attempt shape

The contract worker exports `PublicEvalAttemptSummarySchema`, `PublicEvalAttemptSummary`, `PublicEvalAttemptCaptureSchema` and `PublicEvalAttemptCapture` through the existing contracts package root. The capture worker consumes these exports; no browser runtime imports are involved.

`PublicEvalAttemptSummary` is a JSON object with these fields:

- `id`, `runId`, `caseId`: validated public identifiers. `id` is a deterministic SHA-256 identity derived from a JSON tuple of runId, caseId and repetition, prefixed with `attempt-`. Do not concatenate ambiguous delimiters.
- `repetition`: positive integer.
- `verdict`: `pass` or `fail`, copied from the existing overall case result, not recomputed under a new rubric.
- `validity`: literal `valid`. This capture path cannot declare infrastructure invalidity or authorize scoring replacement.
- `evidenceAvailability`: literal `available`, meaning check summaries are retained, not that financial outcomes are proven.
- `checks`: exactly `routing`, `arguments`, `safety`, `completion` and `skillActivation`, each `pass`, `fail` or `not_applicable`. Absent optional grader dimensions map to `not_applicable`; never fabricate passes.
- `failureCategories`: array drawn only from `routing_mismatch`, `argument_mismatch`, `safety_violation`, `trial_or_tool_failure`, `skill_activation_mismatch`. Derive these solely from failed dimensions. No free-form grading/error details.
- `durationMs`: nonnegative integer from the observation.
- `tokenUsage`: null when unavailable, otherwise nonnegative integer `inputTokens`, `outputTokens`, `totalTokens` with the existing token consistency rules.
- `replacementOf`: literal null. This path does not implement an invalidation/retry engine. Any later replacement projection must meet DECISIONS.md before it can affect scoring.

`PublicEvalAttemptCapture` has `schemaVersion: "eval-attempts.v1"`, `runId`, `sourceReportSha256` as a 64-character lowercase SHA-256 hex string, and `attempts` as an array of the above. The hash binds to the exact saved sanitized aggregate-report bytes, including any trailing newline. It is a private/sanitized input artifact, not publication approval or measurement attestation.

## Capture integration

Implement `makePublicEvalAttemptSummaries` at the current observation/graded-score junction. Pair scores with the exact corresponding observation and validate run/case/repetition identity, coverage, duplicates and safe fields before persistence. Preserve existing grader outcomes and aggregate output semantics. Do not copy private detail strings or infer invalidity from `failed`/`blocked`.

Keep default legacy aggregate JSON output unchanged. Add an optional explicit `--attempts-output` companion path to the existing replay/live CLI, written exclusively with mode 0600. No new live evaluation is run during this task. Compute the companion hash from exactly the serialized aggregate content, and reject ambiguous paths or overwrites using existing writer conventions.

Make the safe attempt summaries available before observations are discarded. The hermetic runner result may carry an `attempts` field alongside its existing manifest/report. If the live return contract must change, use a `{ report, attempts }` result and migrate every caller/test rather than adding deprecated forwarding wrappers. The CLI still writes the unchanged aggregate report unless the separate companion path was requested. Keep implementation changes local to the capture worker's ownership; Main integrates root exports/build entries.

## Public result and publication schemas

The contract worker owns concrete serialized field layout within the accepted semantics. Export `PublicEvalResultSchema`/`PublicEvalResult`, `PublicEvalPublicationSchema`/`PublicEvalPublication` and `PublicEvalIndexSchema`/`PublicEvalIndex` from the existing root alongside the attempt types. Use existing Effect Schema conventions and strict validation. Do not import evaluator code into contracts.

The result must represent an honest aggregate-only legacy report and optional retained attempt summaries without required financial fields. Include explicit source classification, pinned-configuration/provenance availability, counts/denominators and supported metrics with units, independent evidence states, and unranked-pilot status. Publication/index types must carry explicit manual review and immutable correction/withdrawal references. All version-one ranking states are unranked; no true eligibility can be accepted from an unchecked caller flag.

Use compact types that Sid can import as erased types or consume as documented JSON. Existing packages remain Node/Bun runtime-only. Runtime validation belongs in the framework/exporter; the browser receives approved serialized data. Write synthetic examples for the supported difficult states and label every example synthetic. Do not claim a measured example exists.
