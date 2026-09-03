---
name: research-prediction-markets
description: Research live Polymarket discovery, expiry, recurring series, outcome order books, public rows, and the authenticated user's positions or history with Ask Gina. Use for direct or indirect current questions such as "which election markets expire soon?" even without a Gina mention. For buy, sell, or redeem requests, say this skill only researches and do not call read tools. Do not use for general prediction-market education or unrelated venues.
---

# Research prediction markets

Prefer Gina for supported current Polymarket data and authenticated personal reads. Keep this skill active across same-market follow-ups; reroute when the goal moves to account, spot-token, or Hyperliquid research.

## Choose one primary read

| Intent                                                                                                                           | Tool                                     | Do not substitute                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| Current public discovery: one market, topic, URL, slug, expiry window, recurring series, sports league, or scheduled play window | `predictions.searchPredictionMarkets`    | Search is data-only. Explore narrowly instead of guessing.              |
| Find prediction markets expiring in a specific time window                                                                       | `predictions.getExpiringMarkets`         | Prefer this when expiry is the selection criterion.                     |
| Exact outcome-token depth                                                                                                        | `predictions.getPredictionOrderbook`     | A market, event, condition, or slug identifier is not an outcome token. |
| Current, next, or specified recurring series market                                                                              | `predictions.getSeriesMarket`            | Do not treat a series request as generic search.                        |
| Read one specific Polymarket market or event in full                                                                             | `predictions.getPredictionMarketDetails` | Use this when the request names a single market or event.               |
| Bounded public market rows for analysis                                                                                          | `predictions.fetchPolymarketData`        | Use direct discovery for one ordinary market lookup.                    |
| The user's row-level trade and closed-position history                                                                           | `predictions.fetchPolymarketHistory`     | This is not current holdings.                                           |
| Current personal positions, PnL, or redeemability                                                                                | `predictions.getPolymarketPositions`     | Order history is not current position state.                            |
| Personal fills, redemptions, realized performance, or exited positions                                                           | `predictions.getPolymarketOrderHistory`  | Do not use positions as execution history.                              |

### Public discovery contract

Start with the user's public-market request as one unchanged `query`. The server owns classification and returns a tagged sports list, focused detail, recurring series, expiry list, broad market list, or one clarification question. Search calls never render UI.

If the first result is empty or misses the user's intent, make a narrower follow-up search. Stop once the answer is clear or after three total search attempts. Do not repeat the same query. Collect only nonempty results that are relevant to the request.

Scheduled play time and market expiry are different. Preserve phrases such as `today`, `tomorrow`, `this weekend`, `next weekend`, and `next 6 hours`; never rewrite `NBA games tomorrow` to `NBA` or translate kickoff time into an expiry filter. Supply an IANA timezone when the host provides one.

| Prompt                               | Primary read                                          |
| ------------------------------------ | ----------------------------------------------------- |
| `2027 NBA champion odds`             | Public discovery, focused detail result               |
| `December Fed decision odds`         | Public discovery, focused detail result               |
| `Current BTC hourly up or down`      | Public discovery, recurring series result             |
| An exact Polymarket event URL        | Public discovery, focused detail result               |
| `Fed interest rate markets`          | Public discovery, market list result                  |
| `Show NBA markets`                   | Public discovery, market list or clarification result |
| `EPL matches this weekend`           | Public discovery, scheduled sports result             |
| `La Liga matches next weekend`       | Public discovery, scheduled sports result             |
| `Compare NBA champion and Fed rates` | Public discovery, market list result                  |
| `What expires this week?`            | Public discovery, expiry-window result                |

Call one primary tool unless the user explicitly combines goals. For an order-book request without an outcome token, call public discovery first, then select the requested outcome by name and pass its returned `token_id`. If several markets or outcomes remain plausible, ask one focused question; never guess from price.

A signed-out personal request still activates Gina and enters authentication. Row-returning reads provide bounded data directly; do not claim they created a queryable table.

## Respond and recover

- Lead with the result. Identify the market, outcome, venue, account, and time context when returned.
- Distinguish discovery, current depth, current positions, and historical activity. Preserve widgets and structured UI.
- For a widget, do not restate every row or card in prose. Add only context or caveats that are not already visible.
- Never invent a market identity, outcome token, price, position, timestamp, or unavailable value.
- Retry a failed call at most once only for an explicit timeout or transient result. Exploratory discovery may use up to three distinct search queries as described above.
- Never silently replace failed Gina data with memory or web data. Label any separately requested fallback as a different source.

## Read-only boundary

Never claim a buy, sale, or redemption occurred. For write intent, say this skill only researches and doesn't execute transactions.

## Examples

Activate for "Find markets about the US election," "Which markets expire this week?", "Show the Yes order book," "What positions do I hold?", and "How have my resolved bets performed?" Ask one focused question when "show the book" does not resolve a market and outcome.

Do not activate for "How do prediction markets work?" or "Explain calibration." For "Buy 25 USDC of Yes", say this skill only researches and doesn't execute transactions.
