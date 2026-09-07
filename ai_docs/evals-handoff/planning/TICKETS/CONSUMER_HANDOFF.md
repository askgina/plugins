# Prove browser consumer and complete Sid handoff

Map: [Public eval results handoff for Sid](../MAP.md). Decisions: [Approved results handoff decisions](../DECISIONS.md).

- Status: consumer and synthetic runtime proof complete; measured acceptance blocked
- Accountable owner: Main
- Implementation assignee: Main; implementation workers have released their files
- Blocked by: authorized measured aggregate and retained new-run evidence, with recorded manual publication review

Sid starts frontend work from [Define public results contract and fixtures](CONTRACT.md), field definitions and matching fixtures. This final integration proof does not delay his start or transfer framework policy ownership to him.

## Target

Prove a small browser-safe consumer in existing `apps/evals` using public exports. No frontend redesign, launch page, scoring reimplementation or browser filtering of private source data.

## Work

- Integrate the agreed DTO/type boundary without evaluator runtime imports. `@askgina/contracts` supports Node/Bun root ESM only; `@askgina/evals` is Bun-only. Do not expand either package's runtime guarantees.
- Exercise the actual implemented local CLI/export path with permitted inputs, then launch the consumer in its browser runtime.
- Display an actual authorized aggregate report export and an actual new-run case breakdown. Preserve aggregate-only limitations, missing/withheld/unranked states and the distinction between verdict, evidence availability, validity and publication lifecycle.
- Document consumption, field semantics and declared derivations for Sid; he must not recreate grading, eligibility or disclosure policy. Keep canonical documents and fixtures in this repository, with disposable proof copies and receipts under `/tmp`.

## Acceptance

- Runtime screenshots or accessibility evidence show both genuine output types and missing/withheld/unranked states from public exports. Build success alone is insufficient.
- Missing metrics never render as zero. Initial measured comparisons remain unranked pilots; conformance is not answer accuracy or financial settlement.
- Illustrative `apps/evals/src/data.ts` values and synthetic fixtures remain visibly synthetic, separate from measured publications.
- Sid can follow recorded instructions without evaluator imports or private source access.

## Evidence and blockers

The actual Chromium consumer displayed compiled synthetic exports, rejected altered same-ID bytes and malformed UTF-8/BOM, replaced selections, disclosed standalone/index-only limitations and enforced revision/withdrawal visibility. Mobile navigation no longer overflows. Four app regression tests are included in root Vitest. [HANDOFF.md](../../HANDOFF.md) records provenance, commands, screenshots and final gate status.

Measured acceptance has two open blockers per DECISIONS: authorized genuine aggregate evidence and genuine retained new-run case evidence. Complete reachable implementation and execute the real local pipeline with explicitly synthetic inputs if needed. Synthetic execution and screenshots close neither blocker. Record each missing prerequisite; no new live evaluation is authorized.
