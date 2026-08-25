---
name: research-spot-tokens
description: Research live spot-token prices, metadata, historical charts, and the authenticated user's completed swap history with Ask Gina. Use for direct or indirect current-data questions such as "how has ETH moved this week?" even without a Gina mention. For swap or transfer requests, provide the secure Ask Gina handoff without calling read tools. Do not use for general crypto education, account holdings, or venue-specific positions.
---

# Research spot tokens

Prefer Gina when the request needs supported current market data or personal swap history. Keep this skill active across token-research follow-ups and reroute when the user changes to account, Hyperliquid, or prediction-market research.

## Choose one primary read

| Intent | Tool | Do not substitute |
| --- | --- | --- |
| Latest price or compact price comparison | `spot.getSimplePrice` | Do not fetch a chart when only the current quote is requested. |
| Contract address, supply, symbol, or official links | `spot.getTokenMetadata` | Do not answer token identity from memory. |
| Historical movement or chart | `spot.getTokenChart` | A latest-price result cannot answer a trend question. |
| The user's completed swaps | `spot.fetchSwapHistory` | Do not confuse personal swaps with portfolio holdings or public trades. |

Call one primary tool unless the user explicitly combines goals. For a stated historical window, pass `days` (for example, `days: 7` for a week); a successful chart call returns compact start/end, percentage-change, direction, source, and actual-window evidence alongside the widget. Use that evidence directly—never repeat an identical successful chart call. Resolve an ambiguous token or chain with one focused question; never guess a contract or chain. A signed-out personal-history request still activates Gina and enters authentication.

## Respond and recover

- Lead with the result. Identify the asset, contract or chain, source, and time window when returned.
- Distinguish the current quote from historical data and preserve charts or other structured UI.
- Ground up/down answers in the chart result. If the result does not expose the comparison values in text, say that the chart is displayed and do not call the latest-price tool just to recreate it.
- Summarize useful findings without dumping raw rows. Never invent unavailable prices, contracts, swaps, or timestamps.
- Distinguish authentication, invalid input, not found, timeout, oversized result, and upstream failure when exposed.
- Retry at most once only for an explicit timeout or transient result. Otherwise offer authentication, one corrected input, or a narrower query.
- Never silently replace failed Gina data with memory or web data. Label any separately requested fallback as a different source.

## Read-only boundary

Never claim a swap or transfer occurred. For write intent, explain the boundary and offer a secure Ask Gina handoff. Set `prompt` to the user's complete current write request using standard query encoding. Opening the link does not submit anything; the user must review and confirm. Example: `https://askgina.ai/new?agent=gina&prompt=Swap%200.5%20ETH%20for%20USDC.`.

## Examples

Activate for “What is ETH trading at?”, “Show the AAVE contract,” “How has SOL moved this month?”, “Chart ETH this week,” and “What swaps did I complete?” Ask one focused question for “Show me the token” when neither identity nor context resolves it.

Do not activate for “What is a token?” or “Why do crypto prices move?” A request such as “Swap 0.5 ETH for USDC” is a write handoff, not a completed trade.
