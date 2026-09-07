# Export reviewed publications and revision index

Map: [Public eval results handoff for Sid](../MAP.md). Decisions: [Approved results handoff decisions](../DECISIONS.md).

- Status: in progress against concrete schemas; acceptance awaits contract finalization
- Accountable owner: Main
- Implementation assignee: PublicationExporter
- Blocked by: [Define public results contract and fixtures](CONTRACT.md) only
- Releases: [Prove browser consumer and complete Sid handoff](CONSUMER_HANDOFF.md)

## Target

Implement static, reviewed immutable JSON snapshots and an index. Start alongside [Adapt existing sanitized aggregate reports](AGGREGATE_ADAPTER.md) and [Capture safe case and attempt summaries](ATTEMPT_CAPTURE.md), using the contract's fixed input shapes and labeled fixtures. Their outputs and measured evidence are not prerequisites for exporter development. No database, live API, service or approval engine.

## Work

- Consume agreed public inputs without reconstructing discarded detail or changing grading. Enforce the framework allowlist and agreed eligibility rules rather than trusting caller-supplied flags. The browser never filters private data. Preserve evidence states and unavailable metrics without zero-filling.
- Record one explicit manual approval identifying reviewer, time and exact snapshot revision before publication. Sanitization or CI passing is not approval.
- Emit immutable snapshots. Corrections create linked revisions; the index identifies the current revision and withdrawals, without silently rewriting published scores.
- Privacy withdrawal overrides retention: remove sensitive snapshot bytes, including affected prior revisions, and retain only safe notices. Do not expose withdrawn content through historical links.
- Keep synthetic fixtures persistently labeled and separate from measured publications, never promoted through the measured path.

## Acceptance

- Exercise publication with and without recorded approval; only reviewed snapshots become published index entries.
- Show a correction advancing the index while the safe original remains unchanged and linked. A withdrawn publication has a safe notice, not a current-content link.
- Show privacy withdrawal removing affected bytes and historical reachability.
- Inspect outputs for allowlist compliance, explicit missing states and preserved synthetic separation.

## Evidence

Not implemented; not verified. Store exact executed commands and outcomes, snapshot/index references, approval record, correction/withdrawal receipts and checks not run under this temporary directory. Discover actual entrypoints during implementation; no future CLI command is assumed.

Authorized measured aggregate and new-case evidence remain unavailable per DECISIONS. Synthetic pipeline execution proves local behavior only; it cannot close consumer measured-evidence acceptance. No new live evaluation is authorized.
