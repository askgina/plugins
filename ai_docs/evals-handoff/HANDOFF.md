# Sid's public results handoff

The contract and synthetic examples are ready for an independent frontend checkout. Results measure conformance, not financial outcomes. Every v1 result is unranked. Missing information is unavailable, not zero.

## Consume the contract

- Runtime schemas and strict decoders: `packages/contracts/src/eval-results.ts`, exported by `@askgina/contracts`.
- Field definitions: [PUBLIC_CONTRACT.md](planning/PUBLIC_CONTRACT.md).
- Canonical examples: [planning/fixtures/](planning/fixtures/), nine persistently labeled synthetic JSON files. Reference hashes without source files are illustrative, not observations or approval.
- Export requests, configuration identities and manual review: [EXPORTER_REFERENCE.md](planning/EXPORTER_REFERENCE.md).
- The browser may import erased `PublicEvalResult`, `PublicEvalPublication` and `PublicEvalIndex` types. Do not import contracts/evaluator runtime, grade observations or implement publication policy in the frontend.

From a checkout:

```sh
bun install --frozen-lockfile
bun run build
bun run evals:typecheck
bun run evals:dev
```

Visit `/#/handoff`. Select one publication, one index, or one of each. Each selection replaces the previous documents. The file limit is 5 MiB each. A companion index checks the original snapshot bytes and supplies its recorded lifecycle; it does not prove that the local index is the latest or authenticate manual approval. Standalone snapshots and index-only views disclose those limits. Superseded snapshots are historical; tampered and withdrawn result bytes are hidden.

`packages/evals/README.md` documents opt-in `--attempts-output` and `eval:export-public`. Use fresh, canonical output paths. Private inputs stay outside public output. No live evaluation is needed to develop against these fixtures.

## Executed synthetic CLI proof

The proof used the real compiled replay and exporter, not mocked publication calls. The temporary orchestration script ran 14 commands using the checked-in `model-smoke.yaml` and `synthetic-observations.yaml` plus explicitly synthetic local manifests and configuration records.

```sh
bun packages/evals/dist/bin/replay.js --suite packages/evals/src/fixtures/model-smoke.yaml --observations packages/evals/src/fixtures/synthetic-observations.yaml --output <private>/report.json --attempts-output <private>/attempts.json
bun packages/evals/dist/bin/export-public-results.js --manifest <private>/detailed-r1.json --report <private>/report.json --attempts <private>/attempts.json --configuration <private>/configuration.json --output-dir <public>
```

Observed results:

- Default and opted-in report bytes were identical. Replay exited `0`; its aggregate contained 2 passes out of 3. Successful replay/persistence is not an all-pass benchmark.
- Three retained attempts included the original failure. Report and companion permissions were `0600`; public snapshots were `0444`.
- Aggregate-only, detailed, withheld and incomplete exports succeeded with synthetic origin and unranked status. Incomplete coverage had no numeric headline ratio.
- Correction left the previous snapshot unchanged. Privacy withdrawal removed both old result revisions. A later privacy notice removed the previous notice too; the index kept only permitted references and the current notice.
- Unknown manifest fields, measured origin with synthetic review, and zero token observations with nonzero totals failed before publication. Rejection diagnostics did not echo private input markers or paths.

Report SHA-256: `89dccc6a4e63da6ab9537ef51517ffe5bfa293a28cab05f73bdc84f2ec498d8a`.

Companion SHA-256: `8441d3ec56c3db92db46430fff3d1af3b48c1c38e720a8aafe82bb49b3e227a9`.

Local receipts and public copies are under `/tmp/evals-handoff-proof.sSIaey/final/`: `cli-receipts.json`, `summary.json`, `browser-inputs/` and `browser-receipts.json`. The earlier receipt outside `final/` records an incorrect proof-script expectation that replay should exit `1`; source behavior was not changed to satisfy it. Temporary proof helpers were removed from the repository after use.

## Actual browser proof

An isolated Chromium session exercised the app's real file picker with the compiled CLI outputs. It displayed synthetic detailed attempts and unranked status, hid altered same-ID snapshots against their unchanged index, rejected malformed UTF-8 and BOM-prefixed JSON, replaced prior state on new selections, disclosed standalone/index-only limits, showed superseded history, hid withdrawn result metrics, displayed the safe notice, and preserved withheld/incomplete states. Expanding the failed attempt exposed its retained routing/argument failure categories.

Desktop proof used 1440 pixels. At 375 pixels, the new navigation link initially overflowed the page; the navigation now scrolls locally and the document does not overflow. A deliberately delayed SHA-256 completion could not restore a snapshot after a newer index-only selection. The final formatted repository fixtures also paired successfully in the browser. Screenshots: `detailed-desktop.png` and `detailed-mobile.png` beside the local receipts. No browser page errors were reported. These are synthetic consumer proofs, not measured-data acceptance.

## Repository verification

- `bun install --frozen-lockfile`: passed; the checkpoint already included the app workspace link, and no dependency or lockfile change was needed.
- Contracts built before nonincremental root/app `tsc`. Both passed with real instantiations after repairing the first run's 45 errors.
- `bun --bun node_modules/.bin/vp test --run packages/contracts/__tests__ packages/evals/__tests__ apps/evals/__tests__`: 11 files, 123 tests passed. App tests are explicitly included in root Vitest and app TypeScript configuration.
- All nine canonical examples decoded using built contracts. Capture references and every reachable index snapshot hash match the final formatted file bytes. Formatting initially compacted JSON arrays and invalidated those example hashes; the raw-byte browser regressions caught the drift, and the references were regenerated in dependency order.
- `bun run fmt:check`, `bun run lint`, `bun run check`, `bun run test`, `bun run check:target-conformance`, `bun run evals:typecheck` and `bun run evals:build`: passed. Full Vitest result: 21 files, 206 tests passed. Strict lint reports no warnings; temporary helpers were removed and browser promise handling preserves generation checks.
- `bun run artifacts`, `bun run verify:artifacts` and `bun run check:public-boundary`: passed in an isolated clean local snapshot with a frozen install. The public-boundary gate initially found literal synthetic credentials in tests; constructing the same synthetic values at runtime preserved the privacy regressions without shipping credential-shaped literals. No scan rule was weakened.
- The actual eval pack emitted 26 files. Every file matches the existing two-way allowlist exactly once; no speculative chunk patterns were added.
- Controlled mutations in a separate checkout removed canonical attempt checking and the zero-observation token guard, and changed BOM decoding to normalize the bytes. All three targeted regressions failed because the broken paths incorrectly succeeded. Restoring the implementation made all three pass. Receipts: `final/mutations-red.log` and `final/mutations-green.log` under the proof root.
- Read-only review of the named result/capture/publication/browser boundaries against `ace7e54` found no actionable regression. The reviewer did not claim to run tests or browser proof.

Source-gate receipts are in `/tmp/evals-handoff-proof.sSIaey/source-gates-final/`; clean-install artifact receipts are in `/tmp/evals-handoff-proof.sSIaey/artifact-gates-fixed/`. The isolated snapshot contains the same runtime/package changes while leaving the working branch's history unchanged. These are local checks, not remote CI, a release, or deployment proof.

## What remains blocked

Final measured acceptance requires an authorized existing measured aggregate report and a genuine retained new-run case breakdown, with independent provenance and explicit manual publication review. Neither was available. No live MCP/model call, paid benchmark, financial action, deployment or GitHub issue/PR was performed. Eric subsequently authorized multiple commits and pushing `review-wayfinder-maps`; that source-publication permission does not close measured acceptance or authorize deployment.
