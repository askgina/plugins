---
name: lp-pool-scan
description: Use when asked to scan, rank or monitor liquidity pools (Uniswap v2/v3/v4 on Robinhood Chain, Raydium/Orca/Meteora on Solana) for fee APR, impermanent loss, depth/slippage and risk flags, from public data only.
---

# lp-pool-scan

Read-only LP pool scanner. It ranks pools by risk-adjusted fee yield and writes a markdown report plus a JSON snapshot. On each rerun it prints a one-line diff against the previous snapshot.

**Hard rule: read-only.** It only makes HTTP GETs to public APIs, plus `eth_call` / `eth_getLogs` / `eth_getBlockByNumber` to a public RPC. It never signs, sends or simulates a transaction for execution. It needs no wallet, keys or API keys. Do not wire it to any trading or wallet connector.

## Run

```bash
python3 scripts/lp_pool_scan.py --universe allowlist --allowlist my_pools.json --out ./lp-scan-output --top 10
python3 scripts/lp_pool_scan.py --universe top --out ./lp-scan-output                         # daily: 4 tables, ~5–10 min
python3 scripts/lp_pool_scan.py --universe wide --min-tvl 10000 --out ./lp-scan-output      # ~45 min (GeckoTerminal 30/min); resumable
python3 scripts/lp_pool_scan.py --universe allowlist --format json --quiet                 # machine-readable stdout
```

It needs only the Python 3.9+ stdlib. Exit code 0 = ok, 1 = runtime error, 2 = bad arguments or missing allowlist. Errors print one line: `lp_pool_scan: error: …`.

### Flags

| Flag                              | Default                                                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--universe allowlist\|top\|wide` | allowlist                                                | `allowlist` = pools in the allowlist file. `top` = daily mode: GeckoTerminal top pools by 24h volume per chain (+ Raydium/Orca/Meteora volume lists), every tokenized-stock pool (discovery), allowlist and pins; only pools that could make the tables are deep-scanned (see _Daily top mode_). `wide` = allowlist + every tokenized-stock pool (Robinhood Stock Tokens, xStocks, Ondo) + the top-20 ≥$1M TVL pools per chain |
| `--allowlist FILE`                | `$LP_SCAN_ALLOWLIST` or `scripts/example_allowlist.json` | JSON `{"robinhood_chain_4663": {"uniswap-v3": [...], "uniswap-v4": [...]}, "solana": {"raydium-clmm": [...], "raydium-cpmm": [...]}}`                                                                                                                                                                                                                                                                                          |
| `--out DIR`                       | `$LP_SCAN_OUT` or `./lp-scan-output`                     | output root                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--top N`                         | 10                                                       | rows in the allowlist report / JSON summary                                                                                                                                                                                                                                                                                                                                                                                    |
| `--min-tvl X`                     | 10000                                                    | wide-mode dust floor. Sub-floor pools are counted, not ranked                                                                                                                                                                                                                                                                                                                                                                  |
| `--format md\|json\|both`         | both                                                     | `md`: report file + markdown on stdout. `json`: JSON summary on stdout. `both`: report file + markdown on stdout. The snapshot JSON is always written, because the diff needs it                                                                                                                                                                                                                                               |
| `--date YYYY-MM-DD`               | today (Europe/London)                                    | snapshot label                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--quiet`                         | off                                                      | no progress log on stderr                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--render-only`                   | off                                                      | re-score + re-render the latest snapshot (no network)                                                                                                                                                                                                                                                                                                                                                                          |
| `--workers N`                     | 6                                                        | threads for non-rate-limited fetches                                                                                                                                                                                                                                                                                                                                                                                           |
| `--rank-min-tvl X`                | 50000                                                    | wide: a pool needs this TVL (majors: $1M) to get OHLCV vol/IL and security checks, and to be ranked. Pools between `--min-tvl` and this are listed with TVL, volume and fee APR only                                                                                                                                                                                                                                           |
| `--pin ADDR`                      | –                                                        | pool always shown (with full metrics) in the top report's allowlist section. Repeatable; also read from a `"pinned": [...]` list in the allowlist JSON                                                                                                                                                                                                                                                                         |
| `--gt-pages N`                    | 5                                                        | top: GeckoTerminal pages (20 pools each) of top-24h-volume pools per chain                                                                                                                                                                                                                                                                                                                                                     |
| `--stock-candidates N`            | 60                                                       | top: stock pools per chain (TVL ≥ $100k) deep-scanned, picked by best fee-APR proxy                                                                                                                                                                                                                                                                                                                                            |
| `--volume-candidates N`           | 20                                                       | top: pools per chain (TVL ≥ $1M) deep-scanned, picked by highest 24h volume                                                                                                                                                                                                                                                                                                                                                    |
| `--dex-scope core\|all`           | core                                                     | top/wide only. `core` = Robinhood Chain Uniswap v2/v3/v4 + Solana Raydium AMM/CPMM/CLMM; other DEXes (Sushi, PancakeSwap, forks, Orca, Meteora, PumpSwap…) are dropped at discovery, so the candidate budget goes to in-scope pools. Allowlist/pinned pools outside scope are still scanned and shown in the allowlist section, never in the ranked tables. `all` = every DEX (previous behaviour)                             |
| `--security-ttl H`                | 36                                                       | hours to reuse cached GoPlus/RugCheck answers                                                                                                                                                                                                                                                                                                                                                                                  |
| `--cache-ttl MIN`                 | 120                                                      | reuse cached GET responses so an interrupted run resumes; 0 disables                                                                                                                                                                                                                                                                                                                                                           |

### Outputs (under `--out`)

- **Table columns (all reports: top, wide, allowlist), in order:** `#` | `Pool` (pair, chain/DEX, address) | `APR` (= Fee APR 7d: fees only, annualised, LP share) | `Fee` (tier) | `TVL` | `Tier` (wide majors table only) | `Fees 7d` | `IL 7d` | `Net 7d` | `Cover` | `Break-even vs realized` (σw* vs σd·√7, cushion in brackets) | `Vol 24h` / `Vol 7d` (top and allowlist tables show both; wide tables show Vol 7d) | `$1M slip / max fill` | `Flags` | `Allowlist`. Only APR is annualised; IL, Fees, Net are 7-day figures.
- `reports/[top/|wide/]YYYY-MM-DD.md`: ranked tables. Top mode has four (per chain: top 10 by 24h volume, top 10 stock pools by fee cover) plus a short allowlist section with pinned pools. Wide mode has three: (a) tokenized-stock pools, (b) ≥$1M majors with tier, (c) non-allowlist pools worth adding.
- `snapshots/[top/|wide/]YYYY-MM-DD.json`: every pool with every metric, flags, notes and source counts, plus `runtime_s`, `sources.rugcheck_missing` / `goplus_missing`. Wide mode adds `universe_counts` and `sub_floor`; top mode puts pools ≥$100k that were not deep-scanned in `sub_floor` and the selection rule in `sources.top_selection`.
- `snapshots/[wide/]raw/YYYY-MM-DD.json.gz`: raw HTTP responses, for audit.
- `cache/`: v4 PoolKeys (immutable), daily registries, last fetch pickle.

## Formulas

- **Fee APR (24h / 7d)** = volume × fee tier × 365 / TVL × LP share. The 7d version uses vol7d / 7.
  - LP share: Uniswap v3 from `slot0.feeProtocol` (1 − ½(1/p0 + 1/p1)). Uniswap v4 = 1 (protocol fee is charged on top).
  - Raydium: 1 − (protocol + fund)/1e6. The CPMM creator fee is excluded. AMM v4 = 0.88.
  - Orca: 1 − protocolFeeRate/1e4. Meteora DLMM: 1 − protocol_fee_pct.
  - v4 dynamic-fee pools: median fee from recent PoolManager `Swap` events.
- **Volatility**: daily log returns of the pool price (base in quote token), from 30 days of hourly OHLCV resampled to daily. σ_ann = σ_d·√365.
- **Est IL 7d**: σ₇ = σ_d·√7.
  - Full range: σ₇²/8.
  - Concentrated: CE·σ₇²/8, capped at σ₇/2. CE = active liquidity / full-range-equivalent liquidity of the pool TVL (TVL/(2√P) in token1 units), clamped to [1, 200].
  - Constant-product pools: CE = 1. When CE is unknown (Meteora DLMM, forks), it assumes a ±10% range (CE ≈ 21.5) and flags `il_assumed_±10%range`.
- **7-day LP economics (horizon-matched, not annualised).** All in % of TVL over the same 7 days:
  - **Fees 7d** = Fee APR 7d / 52 (LP share, i.e. after protocol/fund fees).
  - **Est IL 7d** = the IL estimate above (σw = σ_daily·√7).
  - **Net 7d** = Fees 7d − Est IL 7d.
  - **Fee cover** = Fees 7d / Est IL 7d (×). Shown `∞ (IL≈0)` when Est IL 7d < 0.0001% and fees > 0; `n/a` when fees or IL are n/a. Stored in JSON as a number or the string `"inf"`.
  - **Break-even move** = the 1-sigma 7-day price move σw* at which Est IL 7d = Fees 7d under the same IL model: σw* = √(8 · Fees7d / C), where C = 1 for constant-product pools (no cap), else the clamped measured CE (or the assumed ±10% range CE ≈ 21.5). For concentrated pools the IL cap applies: if √(8·Fees7d/C) > 4/C (the point where C·σw²/8 reaches σw/2), then σw* = 2 · Fees7d.
  - **Realized 7d move** = σ_daily·√7, shown next to break-even; **cushion** = break-even / realized (> 1 means fees covered the IL implied by the realized move; IL scales with σw², so cover ≈ cushion²).
  - **Why IL is not annualised.** IL is a path- and horizon-dependent cost that scales with σ² over the holding window; it does not compound linearly, and multiplying a 7-day estimate by 365/7 turns small modelling errors into huge APR swings (e.g. −2,982% for an assumed-range pool). Institutional LP framing compares like with like over one horizon: fees earned this week vs the IL the week's realized volatility implies, plus how big a move the fees can absorb. Only Fee APR 7d (fees alone) stays annualised, for comparison with other yields.
  - If IL is `n/a` (too little OHLCV history, or vol not fetched), the pool is **never ranked**. v4 hook/dynamic-fee pools with IL n/a go to a separate **Needs review** list.
  - Snapshot fields: `fees_7d_pct`, `net_7d_pct`, `fee_cover`, `breakeven_move_7d_pct`, `realized_move_7d_pct`. The legacy `net_apr_after_il` (Fee APR 7d − Est IL 7d × 365/7) is still written for back-compat but is not shown or ranked.
- **Score** (allowlist report order) = Fee cover × Π(1 − flag penalty) (∞ treated as 10⁶), tiebreak Net 7d.
  - Penalties: low_tvl .5, depeg .5, honeypot .9, cannot_fill_$1M .3, thin_side .3, new_pool .2, … (see `PEN` in the script).
  - Issuer controls on tokenized stocks are penalised lightly.
- **Slippage** = price impact excluding fee, worst of buy and sell, at $1M/$5M/$10M.
  - Constant-product pools: Δx/(x+Δx) on real reserves (on-chain `getReserves`, Raydium vault amounts, or DexScreener reserves for PumpSwap/DAMM).
  - Uniswap v3/v4: exact tick walk over on-chain initialized ticks within 1/100×–100× of spot.
  - Raydium CLMM: tick walk over `/pools/line/position`.
  - `can't fill (max ~$X)` means the pool runs out of one side.
  - Orca and Meteora DLMM: `n/a`.

## Report filters (applied to every ranked table, allowlist and wide)

- **DEX scope** (top/wide, default `--dex-scope core`): ranked tables contain only Robinhood Uniswap v2/v3/v4 and Solana Raydium pools; enforced at discovery and again on each row's decoded protocol. Snapshots record `dex_scope`; older snapshots without it re-render with all DEXes.
- **RugCheck on verified xStocks**: for mints on the xStocks/Backed issuer list, RugCheck holder-concentration risks (`Single holder ownership`, `Top 10 holders high ownership`, `High ownership`) at level _danger_ are downgraded to the ordinary `holder_conc:SYM` warning (penalty .1, not an exclusion), because issuer custody concentration is structural. A note is added to the pool. Every other RugCheck danger (e.g. `Large Amount of LP Unlocked`, `Low Liquidity`) still yields `rugcheck_danger` and excludes the pool. Non-xStock mints are unchanged.
- **Excluded flags**: `meme_vs_stock` (a real stock token paired with a non-stock, non-major token), `dead_volume` (7d volume under 1% of TVL per day), `rugcheck_danger`, `unverified`, `top_holder*`, `HONEYPOT`, `LOOKALIKE` (a same-name token at a non-registry address).
- **Fake TVL**: the min USD needed to move price ±2% (either side) is under $5k for stock pools or under $50k for other/major pools. Majors also need 7d volume ≥ 10% of TVL.
- **Wide (a) tokenized-stock table**: TVL ≥ $100k, passes the filters, IL measurable, sorted by Fee cover (desc), tiebreak Net 7d.
- **Wide (b) majors table**: TVL ≥ $1M, passes the filters, sorted by TVL, with tier $1M+/$2M+/$5M+ and a $1M slippage column.
- **Wide (c) worth adding**: not on the allowlist, passes (a) or (b), Fee cover > 1×, sorted by Fee cover.
- **Needs review**: v4 hook/dynamic-fee pools with IL n/a.
- **Allowlist report**: same exclusions. Excluded pools are listed with the reason, under the table.
- **Top (1)/(3) volume tables**: per chain, TVL ≥ $1M, passes the filters with the major thresholds (2% depth ≥ $50k, 7d volume ≥ 10% TVL, no dead volume), sorted by 24h volume. Columns include Fees 7d, Est IL 7d, Net 7d, Fee cover and break-even vs realized move; IL n/a pools can appear here with those cells n/a.
- **Top (2)/(4) stock tables**: per chain, same rule as wide (a): TVL ≥ $100k, filters, IL measurable, sorted by Fee cover (desc), tiebreak Net 7d.
- **Top allowlist section**: pinned pools always shown with full metrics (and the exclusion reason, if any); best 5 other allowlist pools by Fee cover; count of excluded allowlist pools by reason.
- **Re-render without refetching**: `--render-only` re-scores and re-renders the latest (or `--date`) snapshot under `--out`. No network.

## Daily top mode (how it stays under ~10 min)

1. Discovery (cheap, no OHLCV): GeckoTerminal top `--gt-pages`×20 pools by 24h volume per chain; Raydium (50), Orca (50) and Meteora DLMM (30) pools by 24h volume; DexScreener token-pairs for every registry stock token that has a pair, plus Raydium-by-mint (run in parallel threads); allowlist; pins. DexScreener pairs give TVL/volume hints for all.
2. Selection: per chain, the top `--stock-candidates` stock pools with TVL ≥ $100k ranked by max(24h fee-APR proxy = vol24 × fee × 365 / TVL, previous snapshot's 7d fee APR), the top `--volume-candidates` pools with TVL ≥ $1M by 24h volume, every allowlist pool with TVL ≥ $100k, and all pins.
3. Deep scan only the selection: GeckoTerminal OHLCV (paced), on-chain depth, GoPlus/RugCheck (prefetched in parallel with OHLCV, cached `--security-ttl` h). v4 PoolKeys and the Ondo list (≤7 days) are reused from cache.
   Caveat: a stock pool whose 24h volume and previous 7d APR are both low but whose 7d APR jumped can be missed; raise `--stock-candidates` or run `wide` weekly.

## Data sources

- **GeckoTerminal** (networks `robinhood`, `solana`; 30 req/min): pools, prices, OHLCV, all-DEX enumeration.
- **DexScreener**: pairs, token-pairs, search.
- **Raydium v3**: `pools/info/ids`, `/mint`, `/list`, `/line/position`.
- **Orca** `api.orca.so/v2`.
- **Meteora** `dlmm.datapi.meteora.ag`.
- **Robinhood Chain RPC** `rpc.mainnet.chain.robinhood.com`: v3 pool and v4 StateView reads, PoolManager logs. Override with `$RH_RPC`.
- **GoPlus** `token_security/4663` (EVM token risk). **RugCheck** (Solana token risk).
- **Registries**: Robinhood `api.robinhood.com/rhj/assets` (canonical Stock Tokens; same-name tokens at other addresses are flagged `LOOKALIKE`) and xStocks `api.xstocks.fi/api/v2/public/assets`. Ondo has no keyless registry, so its tokens are matched by name via DexScreener search.

## Limits

- Most pools cannot absorb $1M in both directions. The depth calculation ignores routing across pools, JIT liquidity and v4 hook logic.
- Fee APR uses current TVL, not average TVL.
- Tokenized-stock 24h volume is structurally low on weekends; use 7d figures.
- Orca and Meteora depth are `n/a`.
- DexScreener token-pairs returns at most 30 pools per token.
- GeckoTerminal pool lists are sorted by activity, not TVL, so a high-TVL pool with zero activity can be missed.
- Wide runs are rate-limit bound (GeckoTerminal at 30/min).
