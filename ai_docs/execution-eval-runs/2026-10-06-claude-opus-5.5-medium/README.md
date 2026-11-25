# Execution evals: Claude Opus 5.5 Medium (Anthropic OAuth), 2026-10-06

18-trial run at source `29c2b66` (main `f3ea57d` plus bounded retries for trials that failed before the model acted, and an MCP startup wait so the host tools load before the first turn; tasks and grader unchanged).

- Model `anthropic/claude-opus-5-5`, reasoning `medium`, OMP 18.4.8 (`1b88f7a0…`), `--no-tools`, Tailscale VM `rentech-ash-coolify`, simulated ledger, scripted user. All ten rows ran at once from one Anthropic OAuth profile.
- OMP 18.4.8 instead of the Grok run's 18.1.21: Anthropic rejects Claude 5.5 models from the older client.
- Identity: 18/18 trials matched exactly one OMP session of this row's own runtime (`anthropic/claude-opus-5-5`, no fallback, thinking `medium`, `anthropic` credential, only `anthropic/claude-opus-5-5` replies). See `native-identity.json`.
- Retries: none. Every slot was graded on its first attempt.
- Three earlier runs from 2026-10-05 were discarded before publication. Under ten concurrent rows OMP sometimes opened a session before the host tools loaded: the first turn had no tools, OMP then sent every tool as deferred, and Anthropic rejected the request (HTTP 400), which the harness graded as a model failure. The run at `b162f57` hit this on 13 of 180 trials; a first fix at `a239cb5` set `mcp.startupTimeoutMs`, which ACP sessions ignore, and was stopped after 26 of 78. `29c2b66` sets `OMP_MCP_STARTUP_TIMEOUT_MS=0`; its first run was stopped when the account hit its 5-hour rate limit (HTTP 429). Every row was rerun at `29c2b66` after the limit reset. The discarded runs stay on the VM.

| Task                               | Passed |
| ---------------------------------- | -----: |
| `t1-base-eth-to-usdc`              |    3/3 |
| `t1-mainnet-sell-99-eth`           |    3/3 |
| `t3-mainnet-eth-to-base-usdc`      |    2/3 |
| `t3-mainnet-wbtc-split`            |    3/3 |
| `t3-monad-mon-to-mainnet-usdc`     |    3/3 |
| `t3-robinhood-eth-to-mainnet-pepe` |    3/3 |

Score 94% (17/18 attempts).

Public chats for all 18 attempts are under `apps/evals/public/transcripts/transactions-claude-opus-5-5-medium/`, projected from the native OMP sessions (see `ai_docs/evals-handoff/public-transcripts.md`).
