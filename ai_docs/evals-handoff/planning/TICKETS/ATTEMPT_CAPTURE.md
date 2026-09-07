# Capture safe case and attempt summaries

[Map](../MAP.md) · [Accepted decisions](../DECISIONS.md)

- Status: preparation against the fixed attempt subset; integration awaits contract completion
- Accountable owner: Main
- Implementation assignee: SafeCaptureWriter
- Blocked by: [contract](CONTRACT.md)
- After contract: parallel with [aggregate adapter](AGGREGATE_ADAPTER.md) and [exporter](PUBLICATION_EXPORT.md); feeds [consumer proof](CONSUMER_HANDOFF.md).

## Target

Durable, explicitly allowlisted summaries for new runs before case/attempt detail is discarded. Existing reports remain aggregate-only. Preserve grading and complete-single-run coverage, including the conformance-only completion meaning in `packages/evals/src/grading.ts:186-201`.

## Work

- Retain stable public run/case/attempt identities, planned repetition association, check identities/verdicts and approved failure categories. Validate identities as public data rather than copying private identifiers. Record capture/contract versions and distinguish unavailable evidence from verdict. Use the authoritative plan/status source for planned attempts; absent output is not proof of a missing attempt.
- Construct summaries from an explicit field allowlist before durable storage/export. Exclude raw prompts, tool arguments/results, transcripts, wallet/account identifiers, secrets and private hosts. Free-form grading/error text is not a category. Define reviewed categorical mappings from supported structured facts; unsupported explanations remain unavailable without changing the original verdict. The browser does not sanitize private data.
- Preserve all safe attempt history and planned scoring repetitions. A rerun must not erase a failure. Represent scoring replacement only under versioned invalidation rules fixed before comparison, an applicable reason, supporting safe evidence references and Eric's recorded approval as benchmark owner. Retain the invalid original and replacement link. `failed` or `blocked` alone never establishes infrastructure failure. Without an applicable rule and approval, no scoring replacement; no automatic retries or approval engine.

## Acceptance

Exercise the actual new-run capture-to-export path with labeled synthetic inputs. Public output preserves identities, check verdicts and earlier failures across attempts; prohibited sentinel values never reach retained summaries or exports. Compare original grading/aggregate results unchanged. Invalidation without required rule/evidence/approval cannot replace a scoring attempt; valid replacement retains history.

## Evidence

None yet. Attach exact commands/outcomes, allowlist/category decisions and safe summary/export references. Genuine new-run case evidence is currently unavailable per DECISIONS. Finish reachable implementation and synthetic replay without live MCP, paid/model calls or financial execution. Closure still requires an actual authorized new-run case breakdown displayed by the local consumer from public exports; mark it pending rather than substituting a synthetic screenshot.
