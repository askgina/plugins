# Ask Gina Predictions

**What this is:** the Ask Gina Predictions MCP server for agents. Use it to
search Polymarket markets, read order books, positions and order history and,
with your approval, to place trades, manage orders, redeem winning positions,
split, merge or convert positions, and top up or withdraw your prediction balance from
your Gina wallet. It can
move real funds, so review every action before you approve it.

- Production MCP: `https://askgina.ai/ai/predictions/mcp`
- Scope: `tools:execute`. This plugin includes trade and balance execution. For
  read-only research, install the separate [Ask Gina](../ask-gina) plugin.
- Skills: none. The plugin is the connection only.

New here? Follow [Install](#install) for your host, then try one of the example
prompts in [What it can do](#what-it-can-do). Maintainers can skip to
[For maintainers](#for-maintainers).

## Install

### Cursor and Grok Bot

1. Install **Ask Gina Predictions** from the Cursor / Grok Bot plugin
   marketplace, or load this folder as a local Cursor plugin
   (`~/.cursor/plugins/local/ask-gina-predictions` as a real directory, not an
   external symlink).
2. Open the Predictions connector and choose **Connect**. Complete Ask Gina
   OAuth in the browser.
3. Confirm the connector lists the Predictions tools.

### Devin

Add the direct `git-subdir` source to a Devin account or enterprise manifest:

```json
{
  "requiredPlugins": [
    {
      "source": "git-subdir",
      "url": "https://github.com/askgina/plugins.git",
      "path": "plugins/ask-gina-predictions"
    }
  ]
}
```

The repository is public, so this source needs no GitHub credentials.

### Other hosts

Claude and Codex read the `ask-gina-plugins` marketplace in this repository.
GitHub Copilot uses the manifest under `targets/copilot`. Each host connects to
the same `https://askgina.ai/ai/predictions/mcp` endpoint.

## What it can do

| Group      | Tools                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Reads      | Market search, expiring markets, sports events, subject markets, exact market lookup, order book, series, positions, order history |
| Execution  | Trade, manage orders, redeem, split, merge and convert positions, top up and withdraw                                              |
| Scheduling | Create, list, toggle, update and delete scheduled prompts                                                                          |
| Context    | Cross-chain portfolio, wallet addresses, web search and URL fetch                                                                  |
| Sandbox    | `bash`, for scripts, SQL over fetched market data and composed workflows                                                           |

The server exposes native Predictions tools and `bash`. `fetchPolymarketData` and
`fetchPolymarketHistory` fill sandbox SQL tables, so they work only inside `bash`.
A `splitMergePredictionPosition` split preview and a `convertPredictionPosition`
preview suggest the same action with `authorized: true` and an editable amount.
For a closed source market they can suggest `redeemPredictionMarket` instead.
`getPolymarketPositions` suggests `redeemPredictionMarket` for redeemable positions.
The server never runs a suggestion. Your host asks first.

Splitting turns pUSD into YES and NO on one market; merging turns a complete
set back into pUSD. Conversion instead turns held NO on an eligible negative-risk
one-winner event into YES on its other outcomes, less any event fee. Conversion
previews send nothing; review the outcomes, fee and approvals before confirming.
Eligibility and recovery are described in [Trading](https://docs.askgina.ai/predictions-mcp/features-trading).

The [native tools page](https://docs.askgina.ai/predictions-mcp/tools) lists
every tool and its annotation class.

Try:

- "Search Polymarket for markets that end today."
- "Show my open prediction positions."
- "Show the order book for a market that ends today."

## Money-moving actions

Trade, order-management, redeem, split-and-merge, conversion, top-up and withdraw tools are marked
destructive. They act at once and cannot always be undone. Your agent must show
you the exact action and wait for your approval in chat before it calls one.
Prediction markets can resolve against you, and you can lose the whole stake.

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
