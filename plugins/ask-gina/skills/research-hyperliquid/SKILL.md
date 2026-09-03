---
name: research-hyperliquid
description: Research live Hyperliquid and HIP-3 markets, prices, charts, account state, positions, orders, fills, performance, and bounded analytics with Ask Gina. Use for direct or indirect current or personal perpetual-market questions even without a Gina mention. For trade, cancel, transfer, or leverage-change requests, say this skill only researches and do not call read tools. Do not use for general perpetuals education or unrelated venues.
---

# Research Hyperliquid

Prefer Gina for supported current Hyperliquid or HIP-3 data and authenticated account reads. Keep this skill active across same-venue follow-ups; reroute when the goal moves to cross-chain account, spot-token, or prediction-market research.

## Choose the narrowest read

| Intent                                                              | Tool                              | Do not substitute                                                          |
| ------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| Current canonical account balance, collateral, or margin            | `perps.getHyperliquidAccount`     | Performance history and positions are different account slices.            |
| Current positions across canonical and enabled HIP-3 venues         | `perps.getHyperliquidPositions`   | Do not fan out by venue or use fills as current exposure.                  |
| Current open orders for canonical or one selected venue             | `perps.getHyperliquidOpenOrders`  | Historical fills are not open orders.                                      |
| Venue-scoped PnL, volume, ROE, or account-value history             | `perps.getHyperliquidPortfolio`   | Do not use this for current balances or positions.                         |
| Browse or search supported markets                                  | `perps.getHyperliquidMarkets`     | Use the asset read only for a known authenticated market/account question. |
| One current midpoint                                                | `perps.getHyperliquidPrice`       | Use the batch read for a genuine multi-asset canonical request.            |
| Several or all canonical midpoints                                  | `perps.getHyperliquidPrices`      | Do not make repeated single-price calls.                                   |
| Authenticated leverage and trading capacity for one venue/coin      | `perps.getHyperliquidAssetData`   | This is not generic market metadata.                                       |
| Browse enabled HIP-3 perpetual DEXes                                | `perps.getHyperliquidPerpDexes`   | Venue discovery is not market discovery.                                   |
| Recent authenticated canonical fills                                | `perps.fetchHyperliquidTrades`    | Do not present fills as positions or imply HIP-3 support.                  |
| Canonical or selected HIP-3 candles and charts                      | `perps.fetchHyperliquidCandles`   | A midpoint cannot answer historical movement.                              |
| Current canonical order-book depth                                  | `perps.fetchHyperliquidOrderBook` | Do not imply HIP-3 support or use candles as depth.                        |
| Materialize bounded fills, candles, or depth for aggregate analysis | `perps.createHyperliquidTable`    | Use direct reads for ordinary lookups.                                     |
| Query the materialized dataset                                      | `perps.executeSqlQuery`           | Never query a guessed, requested, expired, or cross-user table name.       |

Omit provider context for canonical reads. For an enabled HIP-3 venue, pass its returned provider identity only to tools whose schema accepts it. The positions read already consolidates all enabled venues.

For aggregate analysis, first materialize the required dataset. Then pass the exact `tableName` from the successful create result both as the query tool's table name and as the bounded SQL relation; never reuse, sanitize, or reconstruct the requested name. Ask one focused question when a coin or venue remains ambiguous.

## What HIP-3 exposes

HIP-3 is Hyperliquid's builder-deployed perpetual DEX layer. Canonical Hyperliquid lists crypto perps; HIP-3 venues list additional perpetuals that a builder chooses, which today means equities, indices, FX, and commodities alongside some crypto. One venue is enabled: TradeXYZ, provider `hip3:xyz`, USDC collateral. Its markets use the plain ticker as the coin with the venue passed as provider context, for example coin `TSLA` with `{ "providerId": "hip3:xyz" }`.

| Asset class    | Representative xyz tickers                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Equities       | TSLA, NVDA, AAPL, MSFT, META, GOOGL, AMZN, AMD, HOOD, PLTR, COIN, MSTR, CRCL, NFLX, TSM, BABA, GME, SOFTBANK, HYUNDAI |
| Commodities    | GOLD, SILVER, CL (WTI crude), BRENTOIL, NATGAS, COPPER, PLATINUM, PALLADIUM, URANIUM, ALUMINIUM, CORN, WHEAT          |
| Indices and FX | SP500, XYZ100, VIX, VOL, DXY, EUR, JPY, JP225, KR200, XLE, EWY, EWJ                                                   |

The listing changes; confirm a ticker with the markets read scoped to `hip3:xyz` before quoting it. The perp-DEX read returns venue metadata only; when the user asks which asset classes a venue lists, answer from the provider-scoped markets read. Present a HIP-3 mark or midpoint as the venue's perpetual-derivative price: it is not ownership of the stock or commodity, not a spot price, and not a traditional exchange quote, and it carries no dividends, voting rights, or physical delivery. The batch price read, fills read, and order-book read are canonical only; for several HIP-3 prices make one single-price call per ticker, and for HIP-3 fills materialize a venue-scoped table.

Example queries and the read they map to:

- "What is TSLA trading at on Hyperliquid?" → single-price read with coin `TSLA` and `hip3:xyz`.
- "Chart gold perps for the last week" → candles read with coin `GOLD`, `hip3:xyz`, a 1h interval, and a 7-day window.
- "Which stock perps can I trade on Hyperliquid?" → markets read scoped to `hip3:xyz`, grouped by asset class in the answer.
- "How has the S&P 500 perp moved today?" → candles read with coin `SP500` and `hip3:xyz`; never a midpoint alone.
- "Compare WTI and Brent midpoints" → two single-price reads for `CL` and `BRENTOIL` on `hip3:xyz`.
- "Do I have any equity positions on xyz?" → positions read once; filter the consolidated result to the xyz venue.
- "What was my PnL on xyz this month?" → portfolio read with `hip3:xyz` and the month window.
- "Show my NVDA fills on xyz" → materialize a fills table with `hip3:xyz`, then query the returned `tableName`.
- "Show the NVDA order book" → say the depth read covers canonical markets only, then offer the xyz price or candles.

## Respond and recover

- Lead with the result. Identify the account, venue, market, asset, and time window when returned.
- Distinguish current balances, positions, orders, snapshots, fills, and historical performance. Preserve charts and structured UI.
- Never invent a venue, timestamp, provider context, table name, or missing value.
- Retry at most once only for an explicit timeout or transient result. For unavailable table state, rematerialize only through the documented creation path.
- Never silently replace failed Gina data with memory or web data. Label any separately requested fallback as a different source.

## Read-only boundary

Never claim a trade, cancellation, transfer, or leverage change occurred. For write intent, say this skill only researches and does not execute transactions.

## Examples

Activate for "Show my Hyperliquid positions," "Which HIP-3 venues are available?", "How did my account perform this month?", "Chart BTC perps for 24 hours," and "What is the ETH book?" Ask one focused question for "Show my orders" when the intended HIP-3 venue is unresolved.

Do not activate for "How does perpetual funding work?" or "Compare derivatives regulations." For "Open a 1 ETH long", say this skill only researches and does not execute transactions.
