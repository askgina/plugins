# Ask Gina Perps

**What this is:** the Ask Gina Perps MCP server for agents. Use it to read
Hyperliquid account, position, order and market data and, with your approval, to
place, change and cancel perpetual-futures orders, adjust leverage, and deposit
or withdraw funds from your Gina wallet. It can move real funds, so review every
action before you approve it.

- Production MCP: `https://askgina.ai/ai/perps/mcp`
- Scope: `tools:execute`. This plugin includes order and funding execution. For
  read-only research, install the separate [Ask Gina](../ask-gina) plugin.
- Skills: none. The plugin is the connection only.

New here? Follow [Install](#install) for your host, then try one of the example
prompts in [What it can do](#what-it-can-do). Maintainers can skip to
[For maintainers](#for-maintainers).

## Install

### Cursor and Grok Bot

1. Install **Ask Gina Perps** from the Cursor / Grok Bot plugin marketplace, or
   load this folder as a local Cursor plugin
   (`~/.cursor/plugins/local/ask-gina-perps` as a real directory, not an
   external symlink).
2. Open the Perps connector and choose **Connect**. Complete Ask Gina OAuth in
   the browser.
3. Confirm the connector lists the Perps tools.

### Devin

Add the direct `git-subdir` source to a Devin account or enterprise manifest:

```json
{
  "requiredPlugins": [
    {
      "source": "git-subdir",
      "url": "https://github.com/askgina/plugins.git",
      "path": "plugins/ask-gina-perps"
    }
  ]
}
```

The repository is public, so this source needs no GitHub credentials.

### Other hosts

Claude and Codex read the `ask-gina-plugins` marketplace in this repository.
GitHub Copilot uses the manifest under `targets/copilot`. Each host connects to
the same `https://askgina.ai/ai/perps/mcp` endpoint.

## What it can do

| Group     | Tools                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| Reads     | Account, positions, open orders, portfolio, markets, prices, trades, candles, order book, health           |
| Execution | Place and stop orders, cancel and modify orders, leverage, isolated margin, deposit, withdraw, HIP-3 funds |
| Sandbox   | `bash`, for scripts, SQL over captured data and composed workflows                                         |
| Render    | Charts, positions, account overview, markets, open orders, performance                                     |

The server exposes native Perps tools, `perps.render*` tools and `bash`.
The [native tools page](https://docs.askgina.ai/perps-mcp/tools) lists every
native tool and its annotation class.

Only `createHyperliquidTable`, `executeSqlQuery` and `captureAnalysisDataset`
are `bash`-only, because they use sandbox scratch tables.
`previewHyperliquidOrderCost` returns a typed `next` suggestion for
`placeHyperliquidOrder` when the order can fill, and `fetchHyperliquidCandles`
returns one for `perps.renderChart`. Your client shows each suggested call and
waits for your approval.

Try:

- "Show my Hyperliquid positions and open orders."
- "Preview the cost of a small ETH long without placing it."
- "Check my perps account health."

## Money-moving actions

Order, leverage, isolated margin, deposit, withdraw and HIP-3 funding tools are
marked destructive (`readOnlyHint: false`, `destructiveHint: true`,
`openWorldHint: true`). They act at once and cannot always be undone. Your agent
must show you the exact order and wait for your approval in chat before it calls
one. Leveraged positions can be liquidated and lose more than a spot position
would.

`updateHyperliquidIsolatedMargin`, `fundHIP3Dex` and `returnHIP3DexFunds` are
native tools only. `host-tools` and `ts-exec` inside `bash` refuse them with
`HOST_TOOL_LIVE_CONFIRMATION_REQUIRED`, so your MCP client can prompt you before
the call runs.

## Privacy, terms, and support

- Privacy: https://askgina.ai/privacy-policy
- Terms: https://askgina.ai/terms-and-conditions
- Support: https://askgina.ai/support

---

# For maintainers

This directory is a plugin package. `plugin.yaml` is the source of every host
manifest in it and of the root marketplace entries. Run
`bun run manifests:generate` after changing `plugin.yaml`. The tool list and
annotation classes live in `tools/docs/venue-tools.json`; run
`node tools/docs/venue-tools.mjs` after changing it.

| Path                                                  | What lives there                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `plugin.yaml`                                         | Canonical plugin definition and listing data. It lists no skills. |
| `.codex-plugin/`, `.cursor-plugin/`, `.devin-plugin/` | Generated host manifests.                                         |
| `targets/`                                            | Generated Claude and Copilot inputs.                              |
| `.mcp.json`, `mcp.json`                               | Generated MCP server config.                                      |
| `assets/icon.svg`                                     | Plugin logo.                                                      |

The package has no `skills/` directory, so its manifests carry no skills path.
