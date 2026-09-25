# Execution evals: Grok 4.7 Low (xAI OAuth), fresh retest, 2026-09-25

Fresh 18-trial run at source `2bca798` (all fixes: rules stated in tool descriptions, destination gas enforced, same-size slippage baseline, strict Monad all-but-gas target). This is the published result; v3 is diagnostic only.

- Model `xai-oauth/grok-4.7`, reasoning `low`, OMP 18.1.21 (`0d9dfcc4…`), `--no-tools`, coolify VM, simulated ledger, scripted user.
- Identity: all 18 trials matched one OMP session each (`xai-oauth/grok-4.7`, no fallback, thinking `low`). See `native-identity.json`.

| Task                               | Passed |
| ---------------------------------- | -----: |
| `t1-base-eth-to-usdc`              |    3/3 |
| `t1-mainnet-sell-99-eth`           |    3/3 |
| `t3-mainnet-eth-to-base-usdc`      |    3/3 |
| `t3-mainnet-wbtc-split`            |    3/3 |
| `t3-monad-mon-to-mainnet-usdc`     |    3/3 |
| `t3-robinhood-eth-to-mainnet-pepe` |    3/3 |

Score 100% (18/18 attempts).
