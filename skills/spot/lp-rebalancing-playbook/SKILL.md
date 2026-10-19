---
name: lp-rebalancing-playbook
description: >-
  Use this when reviewing concentrated or full-range DEX LP positions (Uniswap
  v3/v4, Raydium CLMM/CPMM, similar) to decide re-range, harvest, compound,
  trim, exit or size limits with explicit numeric rules, and to log every
  proposal and decision. Proposals only; never executes.
---

# LP rebalancing playbook

Numeric rules for managing LP positions. Every rule produces a PROPOSAL, never an action. The owner approves each exact action in chat. Scheduled runs only flag and propose.

## 0. Hard guardrails

- Never execute, sign or move funds without the owner's explicit in-chat approval of that exact action: pool, amounts, range, slippage, fees.
- One approval covers one action. A re-range plus a swap is two actions unless the owner approves both by name.
- Every proposal carries a live quote (quote id, amounts, min-out, slippage, total cost). If the quote expires, re-quote before asking again.
- Read live state before any number. Never estimate a value you can read. Mark unknowns as n/a.
- Rules can conflict. Priority: Exit > Trim > Re-range > Harvest/Compound > Add.

## 1. Inputs to gather each review

Per position: value USD, token amounts, current price, range low/high, in-range flag, hours out of range, uncollected fees USD, 24h and 7d fees, IL vs holding the opening mix (USD), cumulative fees since open.
Per pool: TVL, 24h and 7d volume, fee tier, 7d realized volatility (annualized), stable-leg price, token risk flags.
Book: total LP value, value per pool, value per chain.
Market hours: for tokenized stocks and other session-bound assets, count only open-session hours in the time rules below.

## 2. Re-range

Definitions: center = geometric midpoint of the range; half-width = (high/low)^0.5 - 1; drift = |price/center - 1| / half-width (0 at center, 1 at an edge).
Propose a re-range when ANY holds:

- Out of range for 6 or more consecutive active hours.
- Drift at least 0.8 (price in the outer 20% of the range) for 24 active hours.
- Range width is below 1.0x or above 3.0x the target width (below) after a volatility regime change.
  Only propose if the economics clear: expected fees over the next 7 days in the new range at least 2x the total cost of re-ranging (gas + swap slippage + fee tier on any rebalance swap). Show that math.
  Target range: half-width = k x sigma_daily x sqrt(7), where sigma_daily = 7d realized vol / sqrt(365). k = 1.5 for volatile pairs, 2.0 for session-bound assets (to cover gaps at reopen), 0.5% minimum half-width for stable/stable.
  Cooldown: at most one re-range per position per 72h unless out of range for 24 or more active hours.
  Weekend/closed session: do not re-range a session-bound asset while its market is closed unless out of range; queue for the first hour after open.

## 3. Harvest and compound

Propose harvest when uncollected fees, net of total collect cost, are at least the GREATER of $25 or 10x that cost. Also propose if at least 1% of position value has accrued, or if 30 days have passed with at least $5 uncollected.
Compound (collect and re-add) instead of collecting to stables when ALL hold: position in range with drift below 0.5, pool still passes the exit and trim checks, and the position is below its size cap after adding.
Otherwise collect to the stable leg.

## 4. Trim and exit

Propose a FULL EXIT on any:

- Stable leg depeg beyond 2% from $1 for 1 hour.
- Token risk event: exploit, contract upgrade or admin change, mint or freeze authority newly enabled, trading halt, delisting, or corporate action on a tokenized stock.
- Pool TVL down 70% or more in 7 days.
- Position value down 25% or more in 24h, from price rather than withdrawals.
  Propose a 50% TRIM on any:
- Stable leg depeg beyond 0.5% for 1 hour.
- Pool TVL down 40% or more in 7 days, or 24h volume below 20% of its 30-day average for 3 consecutive active days.
- IL vs holding larger than cumulative fees since open for 7 consecutive days, and pool fee cover below 1x (Fees 7d / Est IL 7d, horizon-matched; never annualize IL).
- Position over a size cap (trim to the cap).
  Flag immediately (alert, no action yet) on a position value drop of 10% or more in 24h, or on any new risk flag from a pool scan.

## 5. Size caps

A position's value must stay at or under ALL of:

- 5% of pool TVL (keeps own exit slippage small and avoids being the pool).
- 25% of the total LP book per pool.
- 60% of the LP book per chain.
- 10% of the LP book for pools under 30 days old or under $250k TVL.
- The size whose full exit costs at most 1% slippage at current depth.
  An add that would breach a cap is proposed only up to the cap.

## 6. Log every proposal and decision

One row per proposal in the owner's proposals log, with: date, position, rule fired, trigger with numbers, action, amount USD, range, slippage, total cost, quote id, decision (Pending, Approved, Declined, Expired, Superseded), tx hash, outcome.
Write the row as Pending when proposed. Update it when the owner decides and again when the transaction settles. A row that is not approved within 24h is Expired.
Also keep a daily position log (value, 24h fees, indicative APR = 24h fees x 365 / value, in range, action) so blended APR = sum(fees) x 365 / sum(value) can be tracked.

## 7. Output for the owner

Verdict first: Hold, or the single highest-priority rule that fired. Then a small table: rule, trigger value vs threshold, proposed action, cost, quote. Silence when no rule fires and nothing material changed, unless the owner asked for a daily summary.

Not financial advice. Thresholds are defaults; the owner can override them per position, and overrides belong in the routine that runs this skill, not here.
