# Public eval results: remote resume checkpoint

Status: work in progress, not a release or a completed Sid handoff.

Eric requested this checkpoint on 2026-09-07 so the session can continue on `ericjuta@codex-lb`. Branch: `review-wayfinder-maps` in `askgina/plugins`. All implementation workers stopped and released their files before the checkpoint build. Their session-local names are not remote worker IDs.

## Read first

1. This file is the current handoff and overrides stale execution/status wording in the planning snapshot.
2. [Accepted decisions](planning/DECISIONS.md) defines the product scope and acceptance criteria.
3. [Map](planning/MAP.md), [worker interfaces](planning/IMPLEMENTATION_CONTRACT.md), and the linked tickets preserve the original plan.
4. [Field reference](planning/PUBLIC_CONTRACT.md) and [exporter reference](planning/EXPORTER_REFERENCE.md) need the corrections listed below. Current source is authoritative for the implemented field layout.

The earlier instruction to keep planning only in a temporary directory, without commits or pushes, was superseded by Eric's explicit request to push this checkpoint with a portable handoff. This does not authorize GitHub issues/PRs, deployment, production changes, live MCP calls, paid/live benchmark calls, or financial execution.

## Goal

Give Sid a versioned public-results contract, fixtures and working exports without asking him to invent scoring, evidence or publication rules. Reuse the existing evaluator and `apps/evals`. This is a conformance-results handoff, not a financial-outcome evaluator, ranking system or frontend redesign.

Existing reports stay aggregate-only. New capture is explicit and allowlisted. Missing data is not zero. All version-one results remain unranked. Public artifacts must exclude private observations and keep synthetic data separate from manually reviewed measured publications.

## Implemented, but not fully verified

- `packages/contracts/src/eval-results.ts`: result, attempt/capture, publication and index schemas; strict decoder helpers; canonical tuple-derived attempt SHA-256 checks. Runtime remains Node/Bun-only; browser consumers use erased types.
- `packages/evals/src/public-attempts.ts`, replay/runner/live and their CLI callers: opt-in capture, exact saved-report binding and exclusive mode-0600 companion output. Default aggregate output is intended to remain unchanged.
- `packages/evals/src/public-results.ts`: aggregate adapter, optional retained/withheld attempts, declared coverage and configuration identity. **There is a known outstanding token guard regression below.**
- `packages/evals/src/publication.ts` and `bin/export-public-results.ts`: immutable snapshots, separate origins, index updates, exact-byte integrity, explicit manual-review subject digest, corrections and privacy withdrawal of old results/notices.
- `apps/evals/src/pages/handoff.tsx` and `src/lib/public-results.ts`: `/#/handoff`, a native public-JSON picker, structural loading checks, raw-byte SHA-256 pairing with an index, and standalone-snapshot disclosure. No evaluator or contracts runtime imports.
- Root API exports, build/CLI entry, `eval:export-public`, narrow artifact chunk inventory and app type-only dependency/lock changes are included.

Late review corrections landed before the freeze but have not received regression or browser proof:

- Configuration declarations require `identity` with `evaluatorSha256`, `skillsSha256`, `toolchainSha256`, `runSettingsSha256`, plus required matching `settings.cleanChat`, `settings.accountClass`, `settings.repetitions`. These are declared immutable identities, not provider/run attestation. No declaration means `labels_only`.
- The shared attempt schema rejects a unique, correctly formatted but noncanonical digest, including direct publication-library calls that bypass the adapter.
- Publication/index identities reject case-folded historical path aliases, including removed revisions.
- The arbitrary 50-revision cap and reserved-final-slot rule were removed. Positive safe-integer counters and a nonempty contiguous history remain, so a later privacy notice can itself be replaced.
- Global `Date` use was removed from contract/publication code to meet the repository's Effect diagnostics.
- Capture persistence and browser parsing now use fatal UTF-8 decoding with BOM preservation. Browser index pairing hashes the original file bytes.

## Resume here

### First fix

Restore the adapter rejection when source token observations are zero but any source token total is nonzero. The last edit to `packages/evals/src/public-results.ts` removed that guard, allowing nonzero totals to disappear into an unavailable metric. The adapter worker reported this before stopping. Restore the guard and a behavioral regression before treating the adapter as complete.

### Integration checks still needed

- Run the focused contracts, capture, adapter, publication and runner regressions. Canonical ID validation may expose downstream fixtures with fabricated attempt IDs; repair their setup without making negative tests fail for an unrelated identity error.
- The publication worker reported an existing lock-directory test cleanup that needs `recursive: true`. Resolve it when running `packages/evals/__tests__/publication.test.ts`.
- Prove invariant tests red/green, especially the canonical ID and saved-report BOM cases. The BOM test is named `rejects a saved report whose bytes gained a UTF-8 BOM and writes no companion`; it includes a successful control write before changing the bytes.
- Verify the browser digest correction using original publication/index files, then an altered publication with unchanged IDs. The altered pair must not display result metrics. Exercise malformed UTF-8, standalone disclosure, superseded/withdrawn states and selection replacement.

### Synthetic CLI and browser proof

The scripts in `proof/` are portable preparation aids, not completed verification. They require built packages and should be removed after the final proof is recorded.

```sh
bun install --frozen-lockfile
bun run build
bun ai_docs/evals-handoff/proof/validate-fixtures.mjs
```

Choose a fresh private output root outside the public directory, then run:

```sh
proof_root="$(mktemp -d)"
bun ai_docs/evals-handoff/proof/create-smoke-inputs.mjs "$proof_root"
bun ai_docs/evals-handoff/proof/pin-smoke-configuration.mjs "$proof_root"
```

The pin step is required after input creation. It records actual compiled evaluator/toolchain hashes, explicit non-applicable synthetic skill usage, and complete hermetic settings. Input creation alone does not supply the newly required identity fields. Run it after the final build so its hashes describe the exercised code.

Replay only the checked-in synthetic inputs:

```sh
bun packages/evals/dist/bin/replay.js --suite packages/evals/src/fixtures/model-smoke.yaml --observations packages/evals/src/fixtures/synthetic-observations.yaml --output "$proof_root/private/report.json" --attempts-output "$proof_root/private/attempts.json"
```

The fixture deliberately contains a grading failure. Interpret the replay exit code alongside the fixture and saved artifact, rather than treating it as a live benchmark result. Compare against a default aggregate-only replay, check byte hashes and mode 0600, and exercise exporter rejection without leaking input values.

Use the generated manifests with the compiled exporter. For example:

```sh
bun packages/evals/dist/bin/export-public-results.js --manifest "$proof_root/private/detailed-r1.json" --report "$proof_root/private/report.json" --attempts "$proof_root/private/attempts.json" --configuration "$proof_root/private/configuration.json" --output-dir "$proof_root/public"
```

Exercise aggregate-only, detailed, withheld and incomplete outputs; correction; then privacy withdrawal. Confirm old public snapshot bytes are absent and the index retains only the allowed notice/references. On hosts where `/tmp` is a symlink, use its canonical path if the exporter rejects a path alias.

Run `bun run evals:dev`, visit `/#/handoff`, and select a publication plus its index. Each selection replaces the prior documents; one publication, one index, or one of each is supported, with a 5 MiB per-file limit. Capture actual browser evidence. Do not substitute schema tests or screenshots of the illustrative legacy pages.

### After the proof

Reconcile docs, format and run the full repository gates in `ai_docs/contributing.md`, plus the app checks/build. Do not suppress diagnostics or weaken tests. Update:

- `planning/PUBLIC_CONTRACT.md`: old shape-only digest wording, removed 50-revision limit and old seven-test count.
- `planning/EXPORTER_REFERENCE.md`: required immutable identity/settings and obsolete 49/50 wording.
- `planning/IMPLEMENTATION_CONTRACT.md` and map/ticket statuses to reflect the final implementation and this repository-backed continuation.
- `packages/evals/README.md`: opt-in capture and local publication commands.

Remove the temporary proof helpers after recording exact commands/results and retaining the agreed synthetic examples. Review the final integration against `main`. No full-suite, artifact-verification, browser-proof or remote-CI success is claimed by this checkpoint.

## Evidence available at transfer

- `bun install --frozen-lockfile` succeeded earlier in the implementation session.
- `bun install` later updated the app's workspace dependency lock without a version bump.
- **Frozen-source `bun run build` passed.** This was run after the final source workers released their files.
- **Frozen-source `bun run evals:typecheck` passed.**
- A small local filesystem probe showed `FileSystem.readFileString` turning the six bytes `EF BB BF 7B 7D 0A` into a string that re-encoded to three bytes. The source correction and regression were authored afterward; their red/green execution is still pending.
- Two read-only reviews found the pinning, canonical-ID, browser-hash, case-alias and revision-cap issues described above. Fixes were authored, but review closure needs executable evidence.
- Full formatting, lint, quality, regression, artifact, CLI-publication and browser checks were **not completed**. No remote CI was run.

## Measured acceptance remains blocked

The Mac-side read-only inventory found no authorized saved aggregate report or retained genuine new-run case evidence. The checked-in examples are synthetic, and their source-reference hashes are illustrative. The actual CLI proof remains to be run; synthetic success cannot close measured acceptance.

Finish all reachable work. If an existing authorized measured artifact is supplied on the remote host, use it under the accepted manual review rules. Do not generate a live evaluation merely to clear this blocker. Final Sid acceptance still requires an actual authorized aggregate export and an actual retained new-run case breakdown in the browser consumer.

## Resume prompt

> Read `ai_docs/evals-handoff/README.md` and its accepted decisions. Continue the WIP public-evals results handoff for Sid. Start by restoring the reported zero-observation/nonzero-token-total guard, then integrate and verify the frozen late review fixes. Keep all synthetic evidence labeled. Complete the CLI/browser proof, docs and repository gates, while keeping genuine measured-evidence acceptance separately blocked unless authorized existing data is supplied. Do not run live evaluations, deploy or create GitHub issues.
