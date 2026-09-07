# Local public-results exporter

This reference describes implemented entrypoints, not an executed publication or measured-evidence result. Main runs build and verification after worker edits settle. No live evaluation, GitHub write or external publication is part of these commands.

## Commands

From the repository root, after the packages have been built:

```sh
bun packages/evals/dist/bin/export-public-results.js --help
bun packages/evals/dist/bin/export-public-results.js --manifest /private/tmp/eval-private/result-request.json --report /private/tmp/eval-private/report.json --output-dir /private/tmp/eval-public
bun packages/evals/dist/bin/export-public-results.js --manifest /private/tmp/eval-private/result-request.json --report /private/tmp/eval-private/report.json --attempts /private/tmp/eval-private/attempts.json --configuration /private/tmp/eval-private/configuration.json --output-dir /private/tmp/eval-public
bun packages/evals/dist/bin/export-public-results.js --manifest /private/tmp/eval-private/withdrawal-request.json --output-dir /private/tmp/eval-public
```

The root `eval:export-public` script builds packages and invokes the same executable. The commands above avoid rebuilding for each export. Report, attempt capture, configuration and request files must stay outside the public output directory. Both lexical containment and canonical aliases are rejected. Hardlinked input files also reject because their other path could expose private bytes inside the public directory. UTF-8 is decoded without normalization; invalid UTF-8 or a leading BOM is rejected rather than changing source hashes.

Use a canonical output path. Symlinks in output path components, including Darwin `/tmp` and `/var` aliases, are rejected; `/private/tmp` is suitable. The output directory must be controlled by the operator. This is a cooperative local writer, not a security boundary against a hostile process replacing directories during an export.

Successful stdout is JSON containing absolute `publicationPath` and `indexPath`. Failures return nonzero with a fixed reason code, never source text, decoder details or filesystem paths.

## Result request

Strict JSON; unknown keys reject. This is an illustrative synthetic request. Its independent provenance must match the chosen report; do not copy values out of an unreviewed report merely to bypass that check.

```json
{
  "schemaVersion": "eval-export-request.v1",
  "kind": "result",
  "publicationId": "synthetic-handoff",
  "revisionId": "synthetic-handoff-v1",
  "revision": 1,
  "dataOrigin": "synthetic",
  "publishedAt": "2026-09-07T12:00:00.000Z",
  "review": { "status": "synthetic_preview" },
  "supersedes": null,
  "resultId": "synthetic-handoff-result",
  "expectedProvenance": {
    "suiteId": "synthetic-suite",
    "suiteVersion": 1,
    "fixtureVersion": 1,
    "catalogSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

Optional result fields:

- `withholdAttempts: true` requires a supplied valid `--attempts` file. The adapter validates its identity, exact report hash and aggregate agreement even though its detail is withheld.
- `declaredCoverage` has positive `plannedCases`, `plannedAttempts` and required SHA-256 `planSha256` / `statusSha256`. These are independently declared authoritative plan and status references, not inferred from missing reports.

A correction keeps `publicationId`, data origin and `runId`, uses a globally unused revision ID within that origin, increments `revision` by one, and supplies:

```json
{
  "revisionId": "synthetic-handoff-v1",
  "revision": 1,
  "reason": "correction",
  "summary": "Corrected the declared benchmark metadata."
}
```

That object is the new request's `supersedes`. Earlier safe snapshots remain byte-for-byte unchanged and reachable as superseded revisions. The exporter reserves the version-one final revision slot for a withdrawal: result revisions are limited to 1 through 49.

## Configuration declaration

`--configuration` supplies an independently reviewed declaration, not proof of the model/provider actually used. Its exact bytes are hashed only after the adapter validates it. Without it, the result says `labels_only` and remains unranked.

The strict `eval-configuration.v1` JSON requires `candidate`, `model`, `target`, nullable `reasoning`, `suiteId`, positive `suiteVersion` / `fixtureVersion`, and `catalogSha`. Candidate/model/target/reasoning must match the report; benchmark provenance must match the independently supplied `expectedProvenance`. Optional `settings` accepts only `cleanChat: true`, `accountClass` and positive `repetitions`, each matching the report. Unknown keys and arbitrary runtime/provider settings reject. All strings are checked by the framework's public-text policy. The declaration does not expose prompts, tool payloads or a generic configuration dictionary.

## Recorded manual approval

Synthetic content requires `dataOrigin: "synthetic"` and exactly `review: {"status":"synthetic_preview"}`. A synthetic DTO cannot be submitted inside a measured publication. Origin is a declaration, not automatic evidence that a source was measured; the human reviewer is responsible for genuine evidence and origin.

Measured content requires a public review object with `status: "approved"`, `method: "manual"`, safe `approvedBy`, UTC `approvedAt`, safe single-line `record`, and `subjectSha256`. Approval must precede publication. Sanitization, a passing test and computing a digest do not constitute approval.

The explicit preparation helper is `publicEvalPublicationSubjectSha256(publication)`, exported from the evaluator module. It accepts a complete publication or the complete publication with root `review` omitted. It removes only root `review`, recursively sorts object keys using JavaScript string comparison, preserves array order, serializes compact JSON without a trailing newline, and returns lowercase SHA-256 of those UTF-8 bytes. `schemaVersion`, publication/revision/run identity, publication time, predecessor metadata, source hashes and all result/notice content are included. String escaping is `JSON.stringify` escaping. Version-one object keys are schema-defined and nonnumeric.

Construct the exact proposed DTO, inspect the public content and independently validate the private sources. Compute the subject digest for that proposal. Only after the reviewer actually approves it, add their recorded manual review with that digest to the manifest. The exporter never creates, fills or repairs an approval. Any bound field change needs a new review/digest, including a schema-valid change to `publishedAt`. Direct API calls enforce the same check as the CLI.

## Withdrawal request

Withdrawal forbids `--report`, `--attempts` and `--configuration`. The CLI resolves the run from the existing origin index; the writer checks that lookup again under its lock.

```json
{
  "schemaVersion": "eval-export-request.v1",
  "kind": "withdrawal",
  "publicationId": "synthetic-handoff",
  "revisionId": "synthetic-handoff-withdrawn",
  "revision": 2,
  "dataOrigin": "synthetic",
  "publishedAt": "2026-09-07T13:00:00.000Z",
  "review": { "status": "synthetic_preview" },
  "supersedes": {
    "revisionId": "synthetic-handoff-v1",
    "revision": 1,
    "reason": "withdrawal",
    "summary": "Removed this synthetic example."
  },
  "notice": {
    "reason": "privacy",
    "withdrawnAt": "2026-09-07T13:00:00.000Z",
    "notice": "This result has been withdrawn."
  }
}
```

Other reason codes are `data_integrity` and `owner_request`. Measured notices require their own bound manual approval. A privacy withdrawal can delete previously indexed unsafe result or notice text, summary and review, but still checks exact prior hashes, schemas, origin, identity and predecessor links. Retained index identifiers and the new notice must be public-safe. Corrections and unrelated promotions do not get that exception. A later notice can replace a withdrawn notice, removing the earlier notice bytes too, while revision capacity remains. Withdrawn results cannot be restored through a result revision. The contract caps history at 50 total revisions; it does not promise unlimited notice revisions after the terminal slot is consumed.

## Files and failures

Layout:

```text
<output>/synthetic/index.json
<output>/synthetic/<publicationId>/<revisionId>.json
<output>/measured/index.json
<output>/measured/<publicationId>/<revisionId>.json
```

Snapshot references in each index are relative to that index's directory. Path identifiers cannot contain colons, slashes or traversal segments; publication directories beginning `index.` and `index` are reserved. Snapshots use exclusive creation and mode 0444. Existing files, orphan files, hardlinked snapshots/indexes, missing/tampered historical files, origin mismatches and stale correction links fail closed.

An atomic `<origin>/index.lock` mkdir excludes other exporters. No retries, database, lock stealing or background service exist. A same-filesystem temporary index inside the private mode-0700 lock directory is renamed over `index.json` only after the snapshot is written. Withdrawal deletes prior snapshot bytes before index promotion and removes their paths/hashes from the index, while retaining safe revision identifiers and the current notice.

Validation failures release the lock. Once disk mutation starts, failure or interruption leaves the lock for operator inspection. An incomplete withdrawal may have already removed some bytes; the writer never restores those bytes or claims success. After confirming no writer is running, manually reconcile the index, snapshots and staged index before removing the lock. Do not simply remove a leftover lock and retry. A completed export releases its lock.

## Integration

Core API: `exportPublicEvalPublication({ publication: unknown, outputDirectory: string })` returns an Effect with `{publicationPath,indexPath}` and `PublicEvalPublicationError` containing a fixed `reason`. It requires the existing Effect FileSystem and Path services. The CLI supplies BunServices/BunRuntime.

Internal CLI helpers are `decodePublicEvalExportRequest`, `makePublicEvalResultPublication`, `makePublicEvalWithdrawalPublication`, and `readPublicEvalIndex`. `readPublicEvalIndex` permits the optional `privacyWithdrawalPublicationId` only for private withdrawal preparation. That lookup can return an unsafe target summary/review that the forthcoming withdrawal removes; never serve this lookup directly. Public consumers use the serialized, verified export.

Focused filesystem regressions live in `packages/evals/__tests__/publication.test.ts`. Main must run the whole file after edits settle, then the real built CLI. Synthetic runs do not satisfy the missing authorized measured aggregate and new-run case acceptance evidence.
