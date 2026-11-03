# Grok 4.7 completed tool-error classification

The recovery worker treated every failed observation as an ungraded process
failure. A model that finished normally after repeatedly calling the wrong tool
therefore escaped the existing routing/completion grader.

The recovery-only revision `completed-model-argument-failure-v1` permits grading
when all of the following evidence is present:

- Native execution ends with an assistant `stop`, without assistant execution
  errors or native tool errors.
- Every failed captured tool call has a distinct matching native MCP
  `INVALID_ARGUMENTS` result; no mixed backend failures are allowed.
- The unchanged grader already rejects routing or arguments, and completion.
- The worker verifies the pinned source, evidence hashes, and model/effort identity
  before saving a grade.

The observation remains failed and its tool errors remain intact. The result is a
graded failure, never a newly passing answer. Schema/backend disagreement alone
does not establish a model mistake. Incomplete runs, provider failures, mixed
native errors, and backend `CONTRACT_MISMATCH`, `NOT_FOUND`, and `UPSTREAM_FAILURE`
remain ungraded under this revision.

## Scope and reproducibility

The change applies to the VM recovery at
`/home/ubuntu/askgina-grok47-recovery-20260922`, not the original 420-trial campaign
or its published leaderboard snapshot. The evaluator remains pinned to
`8e67c7cdd6dacabc108ff20ea112a7b985cab2a3`; model, prompts, tools, grader, trial
selection, and the 720-second budget are unchanged.

`tools/patch-grok47-worker.py` writes a candidate from the exact original worker
SHA `cdb9d4fa1cd3ea561664ca517b8052787a34c5989ee616218536d5907eb7e984`.
It refuses any other baseline and cannot overwrite its source. Install the
candidate alongside `tools/grok47-model-error-classification.ts` only after a
completed trial boundary, then update the worker/helper policy hashes and their
manifest/control bindings. The original campaign must not be patched.

The deployed worker SHA is
`a3360a75e19121017c8a7443962bd23282ff7e61d4c42e3c85d6b6a0a845db39`;
the helper SHA is
`cbb0de8123850dc6889f695081e1808cb017f6e8a933cd14b31aaaef782412cf`.
The same eligibility check runs on resumed grading checkpoints.

## Retained-evidence validation

Private replay on the VM made **zero model/MCP dispatches**, checked source and
transcript/native evidence hashes, and used the existing grader:

| Cohort | Ungraded inspected | Newly eligible failures | Remain ungraded |
| --- | ---: | ---: | ---: |
| Original campaign | 106 (including 39 process errors) | 2 | 104 |
| Recovery at audit time | 3 | 1 | 2 |

The original eligible cases were Low candle repetitions 2 and 3. Low repetition
1, previously scored in a diagnostic-only audit, also contains a native read
error and is excluded by the new mixed-error rule. No original terminal was
changed or published by this replay.

Recovery Medium candle repetition 1 made 11 invalid calls to
`perps.createHyperliquidTable` instead of `perps.fetchHyperliquidCandles` and then
finished normally. Its saved observation now receives the unchanged grader's
failure. High also encountered a native read error; xHigh ended with an assistant
execution error. Neither was converted into a clean model-failure result.

The deployment corrected only the audited Medium terminal, archived its original
bytes and previous policy files, and verified the other nine completed terminal
files were unchanged. No in-flight attempt was interrupted. The unit resumed
automatically with its watchdog and 12-minute trial limit.

Evidence retained under the recovery root:

- `classification-stage-v1/original-audit.json`, SHA
  `e9e391a099cb3e3f71807b84ad33085c04be27f5caa3ba2a48a0bf9659544048`.
- `classification-stage-v1/recovery-audit.json`, SHA
  `6a68f620ee79a8e6d3075a0f109fa1b5b8a063d27a44ccf2cd4b1adf36361363`.
- `classification-change-v1.json`, SHA
  `4a95f021fc8cea89feb9534f001f284dc7e7a187c1e9420dc5832c25050049a1`.
- `policy-versions/classification-v1-before/`: prior worker, policy, control,
  manifest, progress/state, terminal bindings, and the superseded terminal.
- `classification-stage-v1/audit.mjs` and `deploy.py`: exact private replay and
  trial-boundary deployment scripts. Raw observations stay on the VM.

Rollback must also wait for a trial boundary. Restore the archived worker,
policy, control, and manifest together. Keep the correction receipt and original
terminal version; reverting a published/recovered grade requires an explicit
new revision, not deletion of evidence.

Validation: 10 classifier tests plus 13 OMP harness regressions passed, as did
`bun run lint` and the VM's 13 supervisor tests. The harness tests require local
sandbox/server permissions; their providers are mocked.

This fixes one cause of missing grades. The original 24 deterministic tool/fixture
failures, native read failures, and unfinished/provider-error sessions still need
their own diagnosis. Longer timeouts do not resolve those failure classes.
