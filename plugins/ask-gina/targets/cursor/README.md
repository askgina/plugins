# Ask Gina for Cursor and Grok Bot

Ask Gina is a research assistant for crypto, prediction markets, perpetuals, and equities. 
Use it to fetch real-time prices and historical data for tokens, Hyperliquid markets, and Polymarket prediction markets, and to analyze your Gina wallet, positions, and accounts. 

Gina cannot place trades or transfer assets inside Cursor or Grok Bot.

Production MCP: `https://askgina.ai/ai/gina/mcp`  
Scope: `tools:read` only. This plugin does not include transaction execution or transfers.

## Install

1. Install **Ask Gina** from the Cursor / Grok Bot plugin marketplace, or load this folder as a local plugin.
2. Open the Gina connector and choose **Connect**. Complete Ask Gina OAuth in the browser.
3. Confirm the connector shows the read tools (29 catalog tools). Skills below should appear as well.

OAuth callbacks the Gina authorization server must allow:

- `https://www.cursor.com/agents/mcp/oauth/callback` (Cursor / Grok Bot web)
- `http://localhost:8787/callback` (desktop)

## What it can do

| Skill | Use for |
| --- | --- |
| `review-gina-account` | Linked wallets, cross-chain holdings, scheduled prompts |
| `research-spot-tokens` | Live spot prices, metadata, charts, completed swap history |
| `research-hyperliquid` | Hyperliquid / HIP-3 markets, positions, orders, fills |
| `research-prediction-markets` | Polymarket discovery, books, public rows, your positions |

Try: “Show my linked wallets.” / “Chart ETH over the past week.” / “Which prediction markets expire soon?”

## What it cannot do

Gina will not place trades, transfer assets, change leverage, redeem positions, or create/edit schedules from this plugin.

Privacy: https://askgina.ai/privacy-policy  
Terms: https://askgina.ai/terms-and-conditions  
Support: https://askgina.ai/support

## Layout

```
.cursor-plugin/plugin.json
mcp.json
skills/*/SKILL.md
assets/icon.svg
README.md
LICENSE
```

`mcp.json` is URL-only so Cursor and Grok Bot run Streamable HTTP plus MCP OAuth. 
Do not add a bearer header or `"type": "streamable-http"`.

## Source

Canonical overlay: `plugins/ask-gina/targets/cursor/` in [askgina/plugins](https://github.com/askgina/plugins). 

Skills come from `plugins/ask-gina/skills/`. Operating product remains `t-y-b-b/nextjs-ai-chatbot`.
