# Public eval results handoff for Sid

Status: local implementation in progress; measured-evidence acceptance remains blocked.

## Destination

Deliver a versioned public-results contract and working exports so Sid can build the frontend without inventing scoring, evidence or publication rules. Get the contract and fixtures into his hands first. Finished framework delivery requires real-data consumer proof, not just fixtures.

## Notes

- This directory is the temporary canonical tracker, explicitly chosen by Eric instead of GitHub. Nothing here creates a GitHub issue or grants publication authority.
- Execution is explicitly in scope for this local map. The documentation step was accepted. Workflow startup then failed with disk I/O without an implementation run ID, so Main is coordinating direct local tasks rather than retrying or creating a duplicate workflow.
- Main owns coordination and integration. Tickets name their implementation assignee when claimed. Sid owns frontend work outside this map. Eric is the initial benchmark owner for any recorded invalidation approval.
- The [approved decision record](DECISIONS.md) is authoritative for scope, semantics, safety, runtime constraints and acceptance. Do not import the ZIP's larger launch backlog.
- Claim an unassigned ticket only after its blockers are complete. Its Status, Implementation assignee and Evidence fields are canonical. Update this map when the available work changes. Keep shared-file edits with one owner; workers skip validation while writes overlap.
- Allowed future work is local implementation and verification in the existing repository. Planning, evidence and handoff documents stay here. The exclusions in the decision record still apply.

## Decisions so far

All product decisions were resolved in the grilling conversation and confirmed by Eric, including the final pragmatic guardrail. Their complete text lives in [Approved results handoff decisions](DECISIONS.md).

- [Conformance and comparison](DECISIONS.md#result-meaning-and-comparison): honest metrics, explicit coverage and unranked pilots.
- [Attempt history](DECISIONS.md#attempt-history-and-invalidation): preserved failures and no ad hoc scoring replacements.
- [Public boundary](DECISIONS.md#public-boundary-and-delivery): allowlisted, reviewed snapshots, independent evidence states and explicit corrections.
- [Completion criteria](DECISIONS.md#acceptance-and-excluded-work): unblock Sid early without treating missing measured evidence as complete.

## Delivery tickets

| Ticket | Prerequisite |
| --- | --- |
| [Define public results contract and fixtures](TICKETS/CONTRACT.md) | None |
| [Adapt existing sanitized aggregate reports](TICKETS/AGGREGATE_ADAPTER.md) | Contract |
| [Capture safe case and attempt summaries](TICKETS/ATTEMPT_CAPTURE.md) | Contract |
| [Export reviewed publications and revision index](TICKETS/PUBLICATION_EXPORT.md) | Contract |
| [Prove browser consumer and complete Sid handoff](TICKETS/CONSUMER_HANDOFF.md) | Aggregate adapter, capture and exporter |

```text
Contract and fixtures
  +-- Sid builds frontend independently, outside this map
  +-- Aggregate adapter --------+
  +-- Safe attempt capture -----+--> Consumer proof and final handoff
  +-- Publication exporter -----+
```

Current frontier: PublicContractWriter is finishing contract examples and schema regressions. The concrete result/publication/index shapes are now on disk. AggregateAdapter, PublicationExporter and BrowserConsumer are implementing against those shapes while SafeCaptureWriter finishes capture integration. Contract finalization and integrated validation still gate acceptance. Main owns root build/export wiring and integration. The fixed worker interfaces are recorded in [Implementation coordination contract](IMPLEMENTATION_CONTRACT.md).

## Evidence and blockers

The baseline and source references are recorded in [Sources and observed baseline](DECISIONS.md#sources-and-observed-baseline). The seven-file initial documentation bundle passed scoped structural, link and dependency checks. The official SimpleDoc CLI could not initialize. Source implementation is underway; no code verification has run while edits overlap.

The read-only evidence inventory found no authorized measured aggregate or retained new-run case evidence. This blocks measured-evidence acceptance, not contract, adapter, capture or exporter development. Preserve synthetic labels when exercising local fixtures. Finish reachable work and record the exact remaining prerequisite. Do not run a live evaluation to clear it without separate authorization.

## Verification plan

After concurrent edits have stopped, Main integrates and reviews changes against `main`. Use existing repository scripts from its root: `bun run build`, `bun run typecheck`, `bun run evals:typecheck`, `bun run test`, `bun run fmt:check`, `bun run lint`, `bun run check:public-boundary`, and `bun run check:target-conformance`. These are planned checks, not results. Add any required package checks identified by the affected build boundary without changing pinned toolchain versions.

Exercise the implemented local CLI/export entrypoint using permitted inputs and record the exact command and output. The existing `bun run eval:replay -- --suite packages/evals/src/fixtures/model-smoke.yaml --observations packages/evals/src/fixtures/synthetic-observations.yaml --output /tmp/gina-evals-handoff.yTp7Sz/synthetic-replay.json` is synthetic-only smoke, not measured evidence. Use a fresh filename if that output already exists. Do not invent the future export command before it exists.

Verify the actual browser consumer and its import boundary. A test file alone is not consumer proof. Attach focused regression evidence for observable contracts where needed, command receipts, and honest data provenance to the relevant ticket. Keep final `HANDOFF.md` and any evidence artifacts under this directory. Do not report remote CI/CD success from local checks.

## Not yet specified

Concrete compatible contract file locations, type/schema definitions and command names belong to implementation of the accepted tickets. They are not permission to redesign the plan or expand package runtime guarantees. Actual measured input references remain unavailable. No additional product approval stage has been added.

## Out of scope

See [Acceptance and excluded work](DECISIONS.md#acceptance-and-excluded-work) and [Destination and authority](DECISIONS.md#destination-and-authority). In particular, do not add launch/editorial work, financial execution, rankings/statistics work, a database/service/live API, automatic retries, an approval engine or any GitHub/production mutation to this handoff.
