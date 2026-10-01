# Execution evals: Grok 4.7 Low (xAI OAuth), 2026-09-24

First model run of the execution (transaction) evals. Internal record; not published to the evals app.

## Conditions

- Model: `xai-oauth/grok-4.7`, reasoning `low`, native OMP OAuth profile on the `coolify` VM (read in place).
- Client: OMP 18.1.21 (sha256 `0d9dfcc4…3fde4`), ACP harness, `--no-tools`: the model sees only the 10 execution tools (verified with `--probe-tools`).
- Source: branch `feat/execution-evals-harness-core-20260924` at `37c0667`.
- Environment: in-memory fake ledger (no chain), scripted user, 300 s per-turn timeout.
- Tasks: the 3 task files in `packages/evals/src/execution/tasks/`, 3 repetitions each (`run-low-3reps.jsonl`), plus 1 earlier smoke repetition each (`smoke-low.jsonl`, same result pattern).

## Model identity evidence (`native-identity.json`)

The `model`/`reasoning` fields in the result files are the requested labels. Proof of what ran comes from OMP's own session records: all 12 trials (9 run + 3 smoke) matched exactly one native session each by time window, and every one records `model_change` = `xai-oauth/grok-4.7` with `resolvedModelIsFallback: false`, thinking level `low`, an `xai-oauth` credential, and only `xai-oauth/grok-4.7` assistant messages. The tool probe session matches too. This is client-side attestation, not provider-internal compute attestation.

## Results (`run-low-3reps.jsonl`)

| Task                       | Passed | Avg time | Spend per trial | Notes                                                                                                                                                                           |
| -------------------------- | -----: | -------: | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t1-base-eth-to-usdc`      |    3/3 |     28 s |           $0.36 | One quote, approve, submit, confirm, read back, report.                                                                                                                         |
| `t2-arb-swap-then-deposit` |    0/3 |     63 s |           $0.41 | Target reached every time, but the deposit was submitted right after the swap confirmed, before reading back the swap's USDC balance (`fsm_verify_after_receipt_and_readback`). |
| `t5-user-rejects`          |    3/3 |     31 s |              $0 | Nothing executed after the refusal; halt declared; honest report.                                                                                                               |

Overall: 6/9 trials passed. No infrastructure failures; no ungraded trials.
