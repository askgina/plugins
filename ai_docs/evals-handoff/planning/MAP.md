# Public eval results handoff for Sid

Status: implementation, repository/artifact gates and synthetic runtime proof complete; measured-evidence acceptance remains blocked.

## Destination

Deliver a versioned public-results contract and working exports so Sid can build the frontend without inventing scoring, evidence or publication rules. Get the contract and fixtures into his hands first. Finished framework delivery requires real-data consumer proof, not just fixtures.

## Notes

- This repository-backed directory is the canonical tracker instead of GitHub. The portable checkpoint superseded temporary-only planning. Canonical fixtures and the field reference stay here beside the contract; `/tmp` holds only disposable inputs, copies and receipts. Nothing here creates a GitHub issue or grants publication authority.
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

| Ticket                                                                           | Prerequisite                            |
| -------------------------------------------------------------------------------- | --------------------------------------- |
| [Define public results contract and fixtures](TICKETS/CONTRACT.md)               | None                                    |
| [Adapt existing sanitized aggregate reports](TICKETS/AGGREGATE_ADAPTER.md)       | Contract                                |
| [Capture safe case and attempt summaries](TICKETS/ATTEMPT_CAPTURE.md)            | Contract                                |
| [Export reviewed publications and revision index](TICKETS/PUBLICATION_EXPORT.md) | Contract                                |
| [Prove browser consumer and complete Sid handoff](TICKETS/CONSUMER_HANDOFF.md)   | Aggregate adapter, capture and exporter |

```text
Contract and fixtures
  +-- Sid builds frontend independently, outside this map
  +-- Aggregate adapter --------+
  +-- Safe attempt capture -----+--> Consumer proof and final handoff
  +-- Publication exporter -----+
```

Current frontier: documentation returned "Output accepted" and is complete. Contracts, capture, adapter, exporter and browser consumer are implemented with repository-backed examples. Compiled synthetic CLI, actual browser proof, strict repository gates and clean-install artifact verification passed. [HANDOFF.md](../HANDOFF.md) records the evidence. Missing authorized measured inputs remain the data-acceptance prerequisite; no autodoc rerun or live evaluation is authorized.

## Evidence and blockers

The baseline and source references are recorded in [Sources and observed baseline](DECISIONS.md#sources-and-observed-baseline). The documentation step is accepted and needs no further workflow inspection or repair. The [resume handoff](../README.md) records checkpoint build/typecheck results and the remaining regression, runtime and artifact checks.

The read-only evidence inventory found no authorized measured aggregate or retained new-run case evidence. This blocks measured-evidence acceptance, not contract, adapter, capture or exporter development. Preserve synthetic labels when exercising local fixtures. Finish reachable work and record the exact remaining prerequisite. Do not run a live evaluation to clear it without separate authorization.

## Verification plan

After concurrent edits have stopped, Main integrates and reviews changes against `main`. Run every gate in [the contributing guide](../../contributing.md): `bun install --frozen-lockfile`, `bun run fmt:check`, `bun run lint`, `bun run check`, `bun run test`, `bun run check:target-conformance`, `bun run artifacts`, `bun run verify:artifacts`, and `bun run check:public-boundary`. Also run `bun run build`, real consumer TypeScript checks and the app build. Build contracts first with `bun run build` in `packages/contracts`; absent declarations can mask consumer types as `any`. Run package and app regressions after that build. Package tests belong under `packages/**/__tests__/`, not `src/`.

These are required checks, not success claims. Public contract/package changes require clean-source artifact packing and clean-install runtime verification, not only build/typecheck. If dependencies change, regenerate the lockfile without version drift and repeat the frozen install. Before editing the two-way compiled-file allowlist, run `vp -C . pack --filter evals` and inventory the emitted `packages/evals/dist` files. Every allowlist pattern and every file must match exactly once; `bun run artifacts` proves that inventory.

The compiled replay and `export-public-results.js` entrypoints have been exercised using synthetic inputs. [HANDOFF.md](../HANDOFF.md) records exact commands, byte hashes, lifecycle assertions and receipt locations. Future probes must use fresh output paths and preserve origin labels. Synthetic execution is not measured acceptance.

Verify the actual browser consumer and its import boundary. A test file alone is not consumer proof. Attach focused regression evidence for observable contracts where needed, command receipts, and honest data provenance to the relevant ticket. Keep final `HANDOFF.md` and any evidence artifacts under this directory. Do not report remote CI/CD success from local checks.

## Remaining prerequisite

Concrete contract locations, schemas, commands and consumer behavior are implemented and documented. Actual authorized measured input references remain unavailable. No additional product approval stage or expanded package runtime guarantee has been added.

## Out of scope

See [Acceptance and excluded work](DECISIONS.md#acceptance-and-excluded-work) and [Destination and authority](DECISIONS.md#destination-and-authority). In particular, do not add launch/editorial work, financial execution, rankings/statistics work, a database/service/live API, automatic retries, an approval engine or any GitHub/production mutation to this handoff.
