# Execution evals: Grok 4.7 Low (xAI OAuth), rules stated to the model, 2026-09-25

Third run on the 6 published tasks. Superseded by the fresh v4 run for publication.

## What changed from v2

- The tool descriptions now state the execution rules. Each leg must be read back (its balance) before the next leg; a bridge gets its full delay before being called stuck; every wallet that still holds funds keeps gas for one more transaction.
- `list_accounts` returns `gas_per_tx` so the reserve can be computed.
- Grader: destination wallets are no longer exempt from the stranded-funds check.
- Monad task: the mainnet wallet starts with 0.001 ETH of gas, since no route can deliver ETH there.

## Conditions

- Model `xai-oauth/grok-4.7`, reasoning `low`, native OMP OAuth profile on the `coolify` VM (read in place).
- OMP 18.1.21 (sha256 `0d9dfcc4…3fde4`), `--no-tools`. Run at source `8252340`. Simulated ledger, scripted user (approves), 300 s per turn.
- 6 tasks × 3 attempts = 18 trials.

## Re-grading (`run-v3-low-3reps.regraded.jsonl`)

The raw file `run-v3-low-3reps.jsonl` holds the grades at run time. Two grading bugs surfaced in it and were fixed, then the recorded events were re-graded for diagnosis only. This is **not** a valid retest: the signer checks targets when approving a route, so under the new MON target Grok's attempt-1 plan would have been refused and it could have re-planned. The published results come from a fresh run at the final commit (v4).

- **Slippage compared quotes of different sizes.** In split attempts 1 and 3, Grok re-quoted a gas bridge at a smaller amount. The fixed $0.50 fee made the net rate lower, which was flagged as more than 50 bps of slippage. Slippage now compares only same-size quotes of the same leg. Both attempts become passes.
- **"Sell my MON" was graded too loosely** (at least 495 USDC). The target is now all MON but gas, allowing one extra 0.01 MON gas payment (499.385 USDC). Attempt 1 kept 1.98 MON, so it now fails.

## Identity (`native-identity.json`)

All 18 trials matched exactly one OMP session each: `xai-oauth/grok-4.7`, `resolvedModelIsFallback: false`, thinking `low`, `xai-oauth` credential. Client-side attestation.

## Results (re-graded)

| Task                               |                        Passed |
| ---------------------------------- | ----------------------------: |
| `t1-base-eth-to-usdc`              |                           3/3 |
| `t1-mainnet-sell-99-eth`           |                           3/3 |
| `t3-mainnet-eth-to-base-usdc`      |                           3/3 |
| `t3-mainnet-wbtc-split`            |                           3/3 |
| `t3-monad-mon-to-mainnet-usdc`     | 2/3 (attempt 1 kept 1.98 MON) |
| `t3-robinhood-eth-to-mainnet-pepe` |                           3/3 |

Score (mean of per-task pass rates): (5 + 2/3) / 6 = 94.4%. 17/18 attempts passed.
