# Ask Gina Spot

**What this is:** the Ask Gina Spot MCP server and two liquidity-pool skills for
agents. Use it to quote and, with your approval, execute spot token swaps,
transfers, and liquidity-pool operations from your Gina wallet, to read swap
history, wallet addresses, LP positions, and operation status, and to scan and
rebalance LP positions. It can move real funds, so review every quote before you
approve it.

- Production MCP: `https://askgina.ai/ai/spot/mcp`
- Scope: `tools:execute`. This plugin includes transaction execution. For
  read-only research, install the separate [Ask Gina](../ask-gina) plugin.

New here? Follow [Install](#install) for your host, then try one of the example
prompts in [What it can do](#what-it-can-do). Maintainers can skip to
[For maintainers](#for-maintainers).

## Install

### Cursor and Grok Bot

1. Install **Ask Gina Spot** from the Cursor / Grok Bot plugin marketplace, or
   load this folder as a local Cursor plugin
   (`~/.cursor/plugins/local/ask-gina-spot` as a real directory, not an external
   symlink).
2. Open the Spot connector and choose **Connect**. Complete Ask Gina OAuth in
   the browser.
3. Confirm the connector lists the Spot tools. The `lp-rebalancing-playbook`
   skill should appear as well.

### Devin

Add the direct `git-subdir` source to a Devin account or enterprise manifest:

```json
{
  "requiredPlugins": [
    {
      "source": "git-subdir",
      "url": "https://github.com/askgina/plugins.git",
      "path": "plugins/ask-gina-spot"
    }
  ]
}
```

The repository is public, so this source needs no GitHub credentials.

### Other hosts

Claude and Codex read the `ask-gina-plugins` marketplace in this repository.
GitHub Copilot uses the manifest under `targets/copilot`. Each host connects to
the same `https://askgina.ai/ai/spot/mcp` endpoint.

## What it can do

| Skill                     | Use for                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `lp-rebalancing-playbook` | Propose re-range, harvest, compound, trim, or exit with numeric rules       |
| `lp-pool-scan`            | Scan and rank liquidity pools from public data with a bundled Python script |

`lp-rebalancing-playbook` is declared for the Spot MCP skills extension.
`lp-pool-scan` runs a local script, so it ships only in this package.

Try:

- "Quote swapping 100 USDC for ETH."
- "Show my LP positions and propose any rebalancing."
- "Scan the top liquidity pools by fee APR."

## Money-moving actions

Spot execution tools are marked destructive. The skills only propose actions.
Your agent must show you the exact quote and wait for your approval in chat
before it calls an execute tool. Transactions can fail, lose value to slippage
or impermanent loss, and cannot always be reversed.

## Privacy, terms, and support

- Privacy: https://askgina.ai/privacy-policy
- Terms: https://askgina.ai/terms-and-conditions
- Support: https://askgina.ai/support

---

# For maintainers

This directory is a plugin package. `plugin.yaml` is the source of every host
manifest in it and of the root marketplace entries. Run
`bun run manifests:generate` after changing `plugin.yaml`, and
`bun run skills:index` after changing a skill.

| Path                                                  | What lives there                                            |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `plugin.yaml`                                         | Canonical plugin definition, skills list, and listing data. |
| `skills/`                                             | The two skills. Each skill is declared in `plugin.yaml`.    |
| `.codex-plugin/`, `.cursor-plugin/`, `.devin-plugin/` | Generated host manifests.                                   |
| `targets/`                                            | Generated Claude and Copilot inputs.                        |
| `.mcp.json`, `mcp.json`                               | Generated MCP server config.                                |
| `assets/icon.svg`                                     | Plugin logo.                                                |

The `lp-pool-scan` script and its security notes are in
[`skills/lp-pool-scan`](skills/lp-pool-scan).
