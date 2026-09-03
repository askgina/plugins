# @askgina/plugin-core

Committed `src/**`, `plugin.yaml`, `skills/**`, `evals/**`, and `targets/**` are the
canonical plugin inputs. `vp pack` derives the package `dist/` and the custom
packer creates complete host archives under the repository's ignored `dist/`
tree; generated package and host outputs are not source and are never
authoritative.

The repository may build, verify, and archive these artifacts. It does not publish,
release, deploy, or submit them: packaging creates evidence, not publication
authority.

## Cursor and Grok Bot

Ask Gina is a research assistant for crypto, prediction markets, perpetuals, and equities.
Use it to fetch real-time prices and historical data for tokens, Hyperliquid markets, and Polymarket prediction markets, and to analyze your Gina wallet, positions, and accounts.

Gina cannot place trades or transfer assets inside Cursor or Grok Bot.

Production MCP: `https://askgina.ai/ai/gina/mcp`
Scope: `tools:read` only. This plugin does not include transaction execution or transfers.

### Install

1. Install **Ask Gina** from the Cursor / Grok Bot plugin marketplace, or load this folder as a local Cursor plugin (`~/.cursor/plugins/local/ask-gina` as a real directory, not an external symlink).
2. Open the Gina connector and choose **Connect**. Complete Ask Gina OAuth in the browser.
3. Confirm the connector shows the read tools (30 catalog tools). Skills below should appear as well. In Cursor, the four slash commands and the always-on read-only rule should appear too.

Grok Bot loads plugins only from the Cursor marketplace. A local `~/.cursor/plugins/local` install proves the Cursor IDE loader, not Grok Bot.

OAuth callbacks the Gina authorization server must allow:

- `https://www.cursor.com/agents/mcp/oauth/callback` (Cursor / Grok Bot web)
- `localhost:8787/callback` over plain HTTP (Cursor desktop)

### What it can do

| Skill                         | Use for                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `review-gina-account`         | Linked wallets, cross-chain holdings, scheduled prompts    |
| `research-spot-tokens`        | Live spot prices, metadata, charts, completed swap history |
| `research-hyperliquid`        | Hyperliquid / HIP-3 markets, positions, orders, fills      |
| `research-prediction-markets` | Polymarket discovery, books, public rows, your positions   |

Try: "Show my linked wallets." / "Chart ETH over the past week." / "Which prediction markets expire soon?"

Cursor slash commands: `/review-gina-account`, `/research-spot-tokens`, `/research-hyperliquid`, `/research-prediction-markets`. Grok Bot uses skills and MCP only.

### What it cannot do

Gina will not place trades, transfer assets, change leverage, redeem positions, or create/edit schedules from this plugin.

Privacy: https://askgina.ai/privacy-policy
Terms: https://askgina.ai/terms-and-conditions
Support: https://askgina.ai/support

`mcp.json` is URL-only so Cursor and Grok Bot run Streamable HTTP plus MCP OAuth.
Do not add a bearer header or `"type": "streamable-http"`.
