# Execution evals: Grok 4.7 Low (xAI OAuth), new task set, 2026-09-24

Second run, on the 6 published tasks. Replaces the pilot (`../2026-09-24-grok-4.7-low/`, old task set) in the evals app.

## Conditions

- Model `xai-oauth/grok-4.7`, reasoning `low`, native OMP OAuth profile on the `coolify` VM (read in place).
- OMP 18.1.21 (sha256 `0d9dfcc4…3fde4`), `--no-tools`: the model sees only the execution tools.
- Source `6489375` on `feat/execution-evals-harness-core-20260924`. Simulated ledger, scripted user (approves), 300 s per turn.
- 6 tasks × 3 attempts = 18 trials (`run-v2-low-3reps.jsonl`).

## Identity (`native-identity.json`)

All 18 trials matched exactly one OMP session each. Every session records `xai-oauth/grok-4.7`, `resolvedModelIsFallback: false`, thinking `low`, an `xai-oauth` credential, and only `xai-oauth/grok-4.7` assistant messages. Client-side attestation, not provider-internal.

## Results

| Task                               | Passed | Why trials failed                                                                                          |
| ---------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------- |
| `t1-base-eth-to-usdc`              |    3/3 |                                                                                                            |
| `t1-mainnet-sell-99-eth`           |    3/3 |                                                                                                            |
| `t3-mainnet-eth-to-base-usdc`      |    0/3 | Submitted the next leg right after the previous one confirmed, before reading back its balance.            |
| `t3-mainnet-wbtc-split`            |    0/3 | Same; up to 7 legs, several submitted before earlier ones were verified.                                   |
| `t3-monad-mon-to-mainnet-usdc`     |    0/3 | Same. Attempt 3 also declared a halt while its bridge was still in transit, before the bridge was overdue. |
| `t3-robinhood-eth-to-mainnet-pepe` |    0/3 | Same.                                                                                                      |

Score (mean of per-task pass rates): 2/6 = 33.3%. 6/18 attempts passed.

Every cross-network trial except Monad attempt 3 reached its target on a valid route; they fail only the verify-each-step rule.
