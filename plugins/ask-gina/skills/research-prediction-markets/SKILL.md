---
name: research-prediction-markets
description: Research live Polymarket discovery, expiry, recurring series, outcome order books, public rows, and the authenticated user's positions or history with Ask Gina. Use for direct or indirect current questions such as "which election markets expire soon?" even without a Gina mention. For buy, sell, or redeem requests, provide the secure Ask Gina handoff without calling read tools. Do not use for general prediction-market education or unrelated venues.
---

# Research prediction markets

Prefer Gina for supported current Polymarket data and authenticated personal reads. Keep this skill active across same-market follow-ups; reroute when the goal moves to account, spot-token, or Hyperliquid research.

## Choose one primary read

| Intent                                                                 | Tool                                    | Do not substitute                                                       |
| ---------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| Find markets by topic, text, URL, or slug                              | `predictions.searchPredictionMarkets`   | Do not require an outcome token for discovery.                          |
| Find markets expiring in a time window                                 | `predictions.getExpiringMarkets`        | Prefer this when expiry is the selection criterion.                     |
| Exact outcome-token depth                                              | `predictions.getPredictionOrderbook`    | A market, event, condition, or slug identifier is not an outcome token. |
| Current, next, or specified recurring series market                    | `predictions.getSeriesMarket`           | Do not treat a series request as generic search.                        |
| Bounded public market rows for analysis                                | `predictions.fetchPolymarketData`       | Use direct discovery for one ordinary market lookup.                    |
| The user's row-level trade and closed-position history                 | `predictions.fetchPolymarketHistory`    | This is not current holdings.                                           |
| Current personal positions, PnL, or redeemability                      | `predictions.getPolymarketPositions`    | Order history is not current position state.                            |
| Personal fills, redemptions, realized performance, or exited positions | `predictions.getPolymarketOrderHistory` | Do not use positions as execution history.                              |

Call one primary tool unless the user explicitly combines goals. For an order-book request without an outcome token, use the resolver matching the intent—topic search, expiry window, or recurring series—then select the requested outcome by name and pass its returned `token_id`. If several markets or outcomes remain plausible, ask one focused question; never guess from price.

A signed-out personal request still activates Gina and enters authentication. Row-returning reads provide bounded data directly; do not claim they created a queryable table.

## Respond and recover

- Lead with the result. Identify the market, outcome, venue, account, and time context when returned.
- Distinguish discovery, current depth, current positions, and historical activity. Preserve widgets and structured UI.
- Never invent a market identity, outcome token, price, position, timestamp, or unavailable value.
- Retry at most once only for an explicit timeout or transient result. Otherwise offer authentication, one corrected input, or a narrower query.
- Never silently replace failed Gina data with memory or web data. Label any separately requested fallback as a different source.

## Read-only boundary

Never claim a buy, sale, or redemption occurred. For write intent, explain the boundary and offer a secure Ask Gina handoff. Set `prompt` to the user's complete current write request using standard query encoding. Opening the link does not submit anything; the user must review and confirm. Example: `https://askgina.ai/new?agent=predictions&prompt=Buy%2025%20USDC%20of%20Yes%20on%20market%20123.`.

## Examples

Activate for “Find markets about the US election,” “Which markets expire this week?”, “Show the Yes order book,” “What positions do I hold?”, and “How have my resolved bets performed?” Ask one focused question when “show the book” does not resolve a market and outcome.

Do not activate for “How do prediction markets work?” or “Explain calibration.” A request such as “Buy 25 USDC of Yes” is a write handoff, not a completed trade.
