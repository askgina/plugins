# Define public results contract and fixtures

[Map](../MAP.md) · [Accepted decisions](../DECISIONS.md)

- Status: complete, including repository and clean-install package gates
- Accountable owner: Main
- Implementation assignee: Main; source workers have released their files
- Blocked by: none
- Releases: [aggregate adapter](AGGREGATE_ADAPTER.md), [attempt capture](ATTEMPT_CAPTURE.md), [exporter](PUBLICATION_EXPORT.md) and Sid's frontend work.

## Target

Versioned public DTOs/types, runtime validation, field definitions and matching synthetic fixtures. Select and record the concrete browser-safe boundary during implementation. Preserve `@askgina/contracts` Node/Bun root-ESM support and `@askgina/evals` Bun-only support. Do not runtime-import either package in browser code or add browser, edge or subpath support. Runtime constraints are in their existing READMEs.

## Work

- Define counts and denominators, unique cases versus repeated attempts, named conformance dimensions, retained latency percentiles and token usage. Declare units, measurement coverage and derivations. Missing is never zero; accuracy, USD cost and uncertainty remain unavailable without separately declared methods. Completion means conformance, not financial settlement.
- Keep verdict, evidence availability, validity and publication lifecycle independent. Include pinned system configuration, benchmark conditions, provenance, authoritative coverage plan/status references, attempt history and invalidation links. Missing provenance stays visible and unranked; incomplete coverage has no ordinary headline score. Comparisons require matching conditions; measured pilots remain unranked.
- Define immutable snapshot/index, approval, correction/revision and withdrawal references for the exporter. Persistently separate synthetic fixtures from measured publications. The framework owns public allowlisting and eligibility; the browser never receives private source data or recreates grading/disclosure policy.

## Acceptance

Sid can consume types, validated JSON and declared display derivations without evaluator imports. Fixtures cover aggregate-only, new-case detail, conformance pass with unavailable detail, missing-provenance/unranked, incomplete coverage, invalidation/replacement and revision/withdrawal states. Include not evaluated, not applicable, not retained and withheld explicitly. Every fixture stays labeled synthetic; invalid versions, malformed DTOs and prohibited fields are rejected.

## Evidence

Documentation returned "Output accepted" and is complete. Source schemas, package-root exports, discovered contract regressions, the [field reference](../PUBLIC_CONTRACT.md) and [canonical synthetic fixtures](../fixtures/) are repository-backed. All nine examples decoded against built contracts. Real consumer TypeScript checks and the focused 123-test contracts/evals/app run passed. [HANDOFF.md](../../HANDOFF.md) records runtime evidence and final gate status. Version one rejects invalidation and scoring replacement rather than inventing approval rules. Genuine reports are not required to unblock Sid; synthetic fixtures do not close [measured consumer proof](CONSUMER_HANDOFF.md).
